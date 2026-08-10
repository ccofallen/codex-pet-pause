package io.elevenlabs.codexpetpause.bridge

import android.util.AtomicFile
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import io.elevenlabs.codexpetpause.pets.AndroidPetCatalog
import java.util.Base64
import java.util.UUID
import org.json.JSONObject

internal interface StateFileSystem {
    fun readText(file: File): String?
    fun writeAtomically(file: File, value: String)
    fun exists(file: File): Boolean
    fun listChildren(directory: File): List<File>
    fun createTemporarySibling(target: File): File
    fun writeFile(file: File, value: ByteArray)
    fun replaceDirectory(temporary: File, target: File)
    fun deleteRecursively(file: File)
}

internal interface RevisionTokenSource {
    fun nextRevision(): String
}

internal interface RuntimeSnapshotReader {
    fun readRuntimeSnapshot(file: File): String?
}

internal interface PetCatalogSnapshotReader {
    fun readPetCatalog(file: File, catalog: AndroidPetCatalog): String?
}

private object UuidRevisionTokenSource : RevisionTokenSource {
    override fun nextRevision(): String = UUID.randomUUID().toString().replace("-", "")
}

internal class AndroidStateFileSystem : StateFileSystem, RuntimeSnapshotReader, PetCatalogSnapshotReader {
    override fun readText(file: File): String? = if (file.exists()) file.readText(Charsets.UTF_8) else null

    override fun readRuntimeSnapshot(file: File): String? = if (file.exists()) {
        file.bufferedReader(Charsets.UTF_8).use(AndroidRuntimeSnapshot::fromPersistedReader).toJson()
    } else {
        null
    }

    override fun readPetCatalog(file: File, catalog: AndroidPetCatalog): String? = if (file.exists()) {
        file.bufferedReader(Charsets.UTF_8).use(catalog::load)
    } else {
        null
    }

    override fun writeAtomically(file: File, value: String) {
        file.parentFile?.mkdirs()
        val atomicFile = AtomicFile(file)
        var stream: FileOutputStream? = null
        try {
            stream = atomicFile.startWrite()
            stream.write(value.toByteArray(Charsets.UTF_8))
            atomicFile.finishWrite(stream)
            stream = null
        } catch (error: IOException) {
            if (stream != null) atomicFile.failWrite(stream)
            throw error
        }
    }

    override fun exists(file: File): Boolean = file.exists()
    override fun listChildren(directory: File): List<File> = directory.listFiles()?.toList().orEmpty()

    override fun createTemporarySibling(target: File): File {
        val parent = target.parentFile ?: throw IOException("Asset directory has no parent")
        parent.mkdirs()
        return File(parent, ".${target.name}.${UUID.randomUUID()}.tmp")
    }

    override fun writeFile(file: File, value: ByteArray) {
        file.parentFile?.mkdirs()
        file.outputStream().use { it.write(value) }
    }

    override fun replaceDirectory(temporary: File, target: File) {
        if (target.exists()) throw IOException("Immutable asset version already exists")
        if (!temporary.renameTo(target)) throw IOException("Could not install immutable pet assets")
    }

    override fun deleteRecursively(file: File) {
        if (!file.exists()) return
        file.walkBottomUp().forEach { if (!it.delete()) throw IOException("Could not delete ${it.path}") }
    }
}

internal object AndroidStateValidator {
    private val safePetId = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
    private val safeRevision = Regex("^[a-f0-9]{32}$")
    private val canonicalBase64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
    private val actions = setOf("completed", "snoozed", "skipped")
    private val reminderTypes = setOf("lookAway", "drinkWater", "standUp", "takeBreak")
    private val reminderStatuses = setOf("scheduled", "due", "snoozed", "disabled")

    fun requireSafePetId(id: String) {
        require(safePetId.matches(id)) { "Unsafe Android pet id" }
    }

    fun requireSafeRevision(revision: String) {
        require(safeRevision.matches(revision)) { "Unsafe Android pet revision" }
    }

    fun validateSnapshot(value: String) {
        val snapshot = objectValue(value, "Invalid Android state snapshot")
        require(integer(snapshot, "schemaVersion") == 1) { "Unsupported Android state schema" }
        if (snapshot.has("runtimeRevision")) {
            val revision = snapshot.get("runtimeRevision")
            require(
                (revision is Int && revision >= 0) || (revision is Long && revision >= 0L),
            ) { "Invalid Android runtime revision" }
        }
        require(snapshot.has("settingsJson")) { "Invalid Android settings JSON" }
        if (!snapshot.isNull("settingsJson")) validateSettings(string(snapshot, "settingsJson"))
        val history = snapshot.getJSONArray("historyJson")
        for (index in 0 until history.length()) validateActivityEvent(history.getString(index))
        val pets = snapshot.getJSONArray("pets")
        for (index in 0 until pets.length()) validatePetAsset(pets.getJSONObject(index))
        val overlay = snapshot.getJSONObject("overlay")
        finiteNumber(overlay, "xRatio")
        finiteNumber(overlay, "yRatio")
        if (overlay.has("activePet") && !overlay.isNull("activePet")) validatePetAsset(overlay.getJSONObject("activePet"))
    }

    fun validateSettings(value: String) {
        val settings = objectValue(value, "Invalid Android settings JSON")
        require(integer(settings, "schemaVersion") == 5
            && string(settings, "locale") in setOf("zh-CN", "en")
            && boolean(settings, "onboardingComplete")
            && string(settings, "theme") in setOf("light", "dark", "system")
            && string(settings, "petSize") in setOf("small", "medium", "large")
            && boolean(settings, "soundEnabled")
            && boolean(settings, "animationsEnabled")) { "Invalid Android settings JSON" }
        numberInRange(settings, "affinity", 0.0, 100.0)
        val quietHours = settings.getJSONObject("quietHours")
        boolean(quietHours, "enabled")
        integerInRange(quietHours, "startMinutes", 0, 1439)
        integerInRange(quietHours, "endMinutes", 0, 1439)
        validateRuntime(settings.getJSONObject("runtime"))
        require(trimmedLength(settings.getJSONObject("cat"), "name", 1, 20)) { "Invalid Android settings JSON" }
        require(trimmedLength(settings, "activePetId", 1, 64)) { "Invalid Android settings JSON" }
        val position = settings.getJSONObject("petPosition")
        numberInRange(position, "xRatio", 0.0, 1.0)
        numberInRange(position, "yRatio", 0.0, 1.0)
        validateReminders(settings.getJSONArray("reminders"))
    }

    fun validateActivityEvent(value: String) {
        val event = objectValue(value, "Invalid Android history JSON")
        require(nonEmptyString(event, "id") && string(event, "action") in actions) { "Invalid Android history JSON" }
        finiteNumber(event, "occurredAt")
        require(optionalString(event, "reminderId") && optionalString(event, "reminderLabel")) { "Invalid Android history JSON" }
        if (event.has("reminderType") && !event.isNull("reminderType")) {
            require(event.get("reminderType") is String && event.getString("reminderType") in reminderTypes) {
                "Invalid Android history JSON"
            }
        }
    }

    fun validatePetMetadata(value: String, expectedId: String) {
        val metadata = objectValue(value, "Invalid Android pet metadata")
        require(string(metadata, "id") == expectedId
            && nonEmptyString(metadata, "displayName")
            && integer(metadata, "spriteVersion") in 1..2
            && nonEmptyString(metadata, "spritesheetFilename")
            && optionalString(metadata, "description")
            && optionalString(metadata, "atlasRevision")) { "Invalid Android pet metadata" }
        finiteNumber(metadata, "importedAt")
        finiteNumber(metadata, "updatedAt")
        if (metadata.has("frameMetadata") && !metadata.isNull("frameMetadata")) {
            require(metadata.get("frameMetadata") is JSONObject) { "Invalid Android pet metadata" }
        }
    }

    fun decodeSpritesheet(value: String): ByteArray {
        require(value.isNotEmpty() && canonicalBase64.matches(value)) { "Invalid Android pet spritesheet" }
        val decoded = try { Base64.getDecoder().decode(value) }
        catch (error: IllegalArgumentException) { throw IllegalArgumentException("Invalid Android pet spritesheet", error) }
        require(decoded.isNotEmpty() && Base64.getEncoder().encodeToString(decoded) == value) { "Invalid Android pet spritesheet" }
        return decoded
    }

    fun assetDirectory(filesDir: File, assetPath: String): File {
        val parts = assetPath.split('/')
        require(parts.size == 4 && parts[0] == "pets" && parts[3] == "spritesheet.webp") { "Invalid Android pet asset path" }
        requireSafePetId(parts[1])
        requireSafeRevision(parts[2])
        return File(File(File(filesDir, "pets"), parts[1]), parts[2])
    }

    private fun validatePetAsset(asset: JSONObject) {
        val id = string(asset, "id")
        requireSafePetId(id)
        val assetPath = string(asset, "assetPath")
        val directory = assetDirectory(File("/validation"), assetPath)
        require(directory.parentFile?.name == id) { "Invalid Android pet asset path" }
        validatePetMetadata(string(asset, "metadataJson"), id)
        decodeSpritesheet(string(asset, "spritesheetBase64"))
    }

    private fun validateRuntime(runtime: JSONObject) {
        require(optionalFinite(runtime, "pausedAt") && optionalFinite(runtime, "pausedUntil")
            && optionalFinite(runtime, "quietStartedAt")) { "Invalid Android settings JSON" }
        val hasAt = runtime.has("pausedAt") && !runtime.isNull("pausedAt")
        val hasUntil = runtime.has("pausedUntil") && !runtime.isNull("pausedUntil")
        require(hasAt == hasUntil && (!hasAt || runtime.getDouble("pausedAt") <= runtime.getDouble("pausedUntil"))) {
            "Invalid Android settings JSON"
        }
    }

    private fun validateReminders(reminders: org.json.JSONArray) {
        require(reminders.length() in 4..24) { "Invalid Android settings JSON" }
        val ids = mutableSetOf<String>()
        val presets = mutableSetOf<String>()
        var customs = 0
        for (index in 0 until reminders.length()) {
            val reminder = reminders.getJSONObject(index)
            val id = string(reminder, "id")
            require(trimmedLength(reminder, "id", 1, 64) && ids.add(id)
                && boolean(reminder, "enabled")
                && integerInRange(reminder, "intervalMinutes", 1, 720)
                && finiteNumber(reminder, "nextDueAt").isFinite()
                && string(reminder, "status") in reminderStatuses
                && optionalFinite(reminder, "snoozedUntil")) { "Invalid Android settings JSON" }
            when (string(reminder, "kind")) {
                "preset" -> {
                    val type = string(reminder, "type")
                    require(type in reminderTypes && id == type && presets.add(type)) { "Invalid Android settings JSON" }
                    if (reminder.has("optionalActionDurationSeconds")) {
                        require(!reminder.isNull("optionalActionDurationSeconds")) { "Invalid Android settings JSON" }
                        integerInRange(reminder, "optionalActionDurationSeconds", 10, 7200)
                    }
                }
                "custom" -> {
                    customs += 1
                    require(customs <= 20 && id !in reminderTypes && trimmedLength(reminder, "label", 1, 40)) {
                        "Invalid Android settings JSON"
                    }
                }
                else -> throw IllegalArgumentException("Invalid Android settings JSON")
            }
        }
        require(presets == reminderTypes) { "Invalid Android settings JSON" }
    }

    private fun objectValue(value: String, message: String): JSONObject = try { JSONObject(value) }
    catch (error: Exception) { throw IllegalArgumentException(message, error) }
    private fun string(value: JSONObject, key: String): String = value.get(key).let {
        require(it is String) { "Invalid Android JSON field: $key" }; it
    }
    private fun boolean(value: JSONObject, key: String): Boolean = value.get(key).let {
        require(it is Boolean) { "Invalid Android JSON field: $key" }; true
    }
    private fun nonEmptyString(value: JSONObject, key: String) = string(value, key).isNotEmpty()
    private fun optionalString(value: JSONObject, key: String) = !value.has(key)
        || (!value.isNull(key) && value.get(key) is String)
    private fun optionalFinite(value: JSONObject, key: String) = !value.has(key)
        || (!value.isNull(key) && value.get(key) is Number && (value.get(key) as Number).toDouble().isFinite())
    private fun integer(value: JSONObject, key: String): Int = value.get(key).let {
        require(it is Number && it.toDouble().isFinite() && it.toDouble() % 1.0 == 0.0) { "Invalid Android JSON field: $key" }
        it.toInt()
    }
    private fun integerInRange(value: JSONObject, key: String, minimum: Int, maximum: Int): Boolean {
        require(integer(value, key) in minimum..maximum) { "Invalid Android JSON field: $key" }
        return true
    }
    private fun finiteNumber(value: JSONObject, key: String): Double = value.get(key).let {
        require(it is Number && it.toDouble().isFinite()) { "Invalid Android JSON field: $key" }; it.toDouble()
    }
    private fun numberInRange(value: JSONObject, key: String, minimum: Double, maximum: Double) {
        require(finiteNumber(value, key) in minimum..maximum) { "Invalid Android JSON field: $key" }
    }
    private fun trimmedLength(value: JSONObject, key: String, minimum: Int, maximum: Int): Boolean {
        val text = string(value, key)
        val length = text.codePointCount(0, text.length)
        return text == text.trim() && length in minimum..maximum
    }
}

internal class AndroidStateStore(
    internal val filesDir: File,
    internal val fileSystem: StateFileSystem = AndroidStateFileSystem(),
    private val revisions: RevisionTokenSource = UuidRevisionTokenSource,
) {
    private val stateFile = File(filesDir, "state.json")
    private val petsRoot = File(filesDir, "pets")

    fun readSnapshot(): String? = fileSystem.readText(stateFile)

    fun readRuntimeSnapshot(): String? = when (fileSystem) {
        is RuntimeSnapshotReader -> fileSystem.readRuntimeSnapshot(stateFile)
        else -> fileSystem.readText(stateFile)?.let(AndroidRuntimeSnapshot::fromPersistedJson)?.toJson()
    }

    fun readPetCatalog(catalog: AndroidPetCatalog): String? = when (fileSystem) {
        is PetCatalogSnapshotReader -> fileSystem.readPetCatalog(stateFile, catalog)
        else -> fileSystem.readText(stateFile)?.reader()?.use(catalog::load)
    }

    fun writeSnapshot(snapshotJson: String) {
        AndroidStateValidator.validateSnapshot(snapshotJson)
        fileSystem.writeAtomically(stateFile, snapshotJson)
    }

    fun writeNewPetVersion(id: String, metadataJson: String, spritesheetBase64: String): String {
        repeat(8) {
            val revision = revisions.nextRevision()
            AndroidStateValidator.requireSafeRevision(revision)
            val target = versionDirectory(id, revision)
            if (!fileSystem.exists(target)) return writePetVersion(id, revision, metadataJson, spritesheetBase64)
        }
        throw IOException("Could not allocate a unique pet revision")
    }

    fun writePetVersion(id: String, revision: String, metadataJson: String, spritesheetBase64: String): String {
        AndroidStateValidator.requireSafePetId(id)
        AndroidStateValidator.requireSafeRevision(revision)
        AndroidStateValidator.validatePetMetadata(metadataJson, id)
        val spritesheet = AndroidStateValidator.decodeSpritesheet(spritesheetBase64)
        val target = versionDirectory(id, revision)
        require(!fileSystem.exists(target)) { "Immutable Android pet revision already exists" }
        val temporary = fileSystem.createTemporarySibling(target)
        try {
            fileSystem.writeFile(File(temporary, "pet.json"), metadataJson.toByteArray(Charsets.UTF_8))
            fileSystem.writeFile(File(temporary, "spritesheet.webp"), spritesheet)
            fileSystem.replaceDirectory(temporary, target)
        } catch (error: Throwable) {
            runCatching { fileSystem.deleteRecursively(temporary) }
            throw error
        }
        return "pets/$id/$revision/spritesheet.webp"
    }

    fun deleteAsset(assetPath: String) {
        val directory = AndroidStateValidator.assetDirectory(filesDir, assetPath)
        fileSystem.deleteRecursively(directory)
        val idDirectory = directory.parentFile ?: return
        if (fileSystem.listChildren(idDirectory).isEmpty()) runCatching { fileSystem.deleteRecursively(idDirectory) }
    }

    fun deleteAllPetDirectories() {
        fileSystem.listChildren(petsRoot).forEach { child -> runCatching { fileSystem.deleteRecursively(child) } }
        if (fileSystem.listChildren(petsRoot).isEmpty()) runCatching { fileSystem.deleteRecursively(petsRoot) }
    }

    private fun versionDirectory(id: String, revision: String) = File(File(petsRoot, id), revision)
}
