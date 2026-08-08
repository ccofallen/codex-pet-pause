package io.elevenlabs.codexpetpause.bridge

import android.util.AtomicFile
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Base64
import java.util.UUID
import org.json.JSONObject

internal interface StateFileSystem {
    fun readText(file: File): String?
    fun writeAtomically(file: File, value: String)
    fun exists(file: File): Boolean
    fun createTemporarySibling(target: File): File
    fun writeFile(file: File, value: ByteArray)
    fun replaceDirectory(temporary: File, target: File)
    fun deleteRecursively(file: File)
}

internal class AndroidStateFileSystem : StateFileSystem {
    override fun readText(file: File): String? = if (file.exists()) file.readText(Charsets.UTF_8) else null

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

    override fun createTemporarySibling(target: File): File {
        val parent = target.parentFile ?: throw IOException("Pet directory has no parent")
        parent.mkdirs()
        return File(parent, ".${target.name}.${UUID.randomUUID()}.tmp")
    }

    override fun writeFile(file: File, value: ByteArray) {
        file.parentFile?.mkdirs()
        file.outputStream().use { it.write(value) }
    }

    override fun replaceDirectory(temporary: File, target: File) {
        val parent = target.parentFile ?: throw IOException("Pet directory has no parent")
        val backup = File(parent, ".${target.name}.${UUID.randomUUID()}.backup")
        val hadTarget = target.exists()
        if (hadTarget && !target.renameTo(backup)) throw IOException("Could not preserve existing pet")
        try {
            if (!temporary.renameTo(target)) throw IOException("Could not replace pet assets")
            if (hadTarget) deleteRecursively(backup)
        } catch (error: IOException) {
            if (hadTarget && !target.exists()) backup.renameTo(target)
            throw error
        }
    }

    override fun deleteRecursively(file: File) {
        if (!file.exists()) return
        file.walkBottomUp().forEach { if (!it.delete()) throw IOException("Could not delete ${it.path}") }
    }
}

internal object AndroidStateValidator {
    private val safePetId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    private val canonicalBase64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
    private val actions = setOf("completed", "snoozed", "skipped")
    private val reminderTypes = setOf("lookAway", "drinkWater", "standUp", "takeBreak")

    fun requireSafePetId(id: String) {
        require(safePetId.matches(id)) { "Unsafe Android pet id" }
    }

    fun validateSnapshot(value: String) {
        val snapshot = objectValue(value, "Invalid Android state snapshot")
        require(integer(snapshot, "schemaVersion") == 1) { "Unsupported Android state schema" }
        validateSettings(string(snapshot, "settingsJson"))
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
        require(integer(settings, "schemaVersion") == 5) { "Invalid Android settings JSON" }
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
        val decoded = try {
            Base64.getDecoder().decode(value)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid Android pet spritesheet", error)
        }
        require(decoded.isNotEmpty() && Base64.getEncoder().encodeToString(decoded) == value) {
            "Invalid Android pet spritesheet"
        }
        return decoded
    }

    private fun validatePetAsset(asset: JSONObject) {
        val id = string(asset, "id")
        requireSafePetId(id)
        require(string(asset, "assetPath") == "pets/$id/spritesheet.webp") { "Invalid Android pet asset path" }
        validatePetMetadata(string(asset, "metadataJson"), id)
        decodeSpritesheet(string(asset, "spritesheetBase64"))
    }

    private fun objectValue(value: String, message: String): JSONObject = try {
        JSONObject(value)
    } catch (error: Exception) {
        throw IllegalArgumentException(message, error)
    }

    private fun string(value: JSONObject, key: String): String {
        val candidate = value.get(key)
        require(candidate is String) { "Invalid Android JSON field: $key" }
        return candidate
    }

    private fun nonEmptyString(value: JSONObject, key: String): Boolean = string(value, key).isNotEmpty()

    private fun optionalString(value: JSONObject, key: String): Boolean =
        !value.has(key) || value.isNull(key) || value.get(key) is String

    private fun integer(value: JSONObject, key: String): Int {
        val candidate = value.get(key)
        require(candidate is Number && candidate.toDouble().isFinite() && candidate.toDouble() % 1.0 == 0.0) {
            "Invalid Android JSON field: $key"
        }
        return candidate.toInt()
    }

    private fun finiteNumber(value: JSONObject, key: String): Double {
        val candidate = value.get(key)
        require(candidate is Number && candidate.toDouble().isFinite()) { "Invalid Android JSON field: $key" }
        return candidate.toDouble()
    }
}

internal class AndroidStateStore(
    internal val filesDir: File,
    internal val fileSystem: StateFileSystem = AndroidStateFileSystem(),
) {
    private val stateFile = File(filesDir, "state.json")
    internal val safePetId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

    fun readSnapshot(): String? = fileSystem.readText(stateFile)

    fun writeSnapshot(snapshotJson: String) {
        AndroidStateValidator.validateSnapshot(snapshotJson)
        fileSystem.writeAtomically(stateFile, snapshotJson)
    }

    fun clearSnapshot() {
        fileSystem.deleteRecursively(stateFile)
    }

    fun writePet(id: String, metadataJson: String, spritesheetBase64: String) {
        AndroidStateValidator.requireSafePetId(id)
        AndroidStateValidator.validatePetMetadata(metadataJson, id)
        val spritesheet = AndroidStateValidator.decodeSpritesheet(spritesheetBase64)
        val target = petDirectory(id)
        val temporary = fileSystem.createTemporarySibling(target)
        try {
            fileSystem.writeFile(File(temporary, "pet.json"), metadataJson.toByteArray(Charsets.UTF_8))
            fileSystem.writeFile(File(temporary, "spritesheet.webp"), spritesheet)
            fileSystem.replaceDirectory(temporary, target)
        } catch (error: Throwable) {
            runCatching { fileSystem.deleteRecursively(temporary) }
            throw error
        }
    }

    fun savePetAndSnapshot(id: String, metadataJson: String, spritesheetBase64: String, snapshotJson: String) {
        AndroidStateValidator.requireSafePetId(id)
        AndroidStateValidator.validatePetMetadata(metadataJson, id)
        AndroidStateValidator.decodeSpritesheet(spritesheetBase64)
        AndroidStateValidator.validateSnapshot(snapshotJson)
        val previous = readSnapshot()
        val target = petDirectory(id)
        val backup = fileSystem.createTemporarySibling(target)
        var backedUp = false
        var installed = false
        try {
            if (fileSystem.exists(target)) {
                fileSystem.replaceDirectory(target, backup)
                backedUp = true
            }
            writePet(id, metadataJson, spritesheetBase64)
            installed = true
            writeSnapshot(snapshotJson)
        } catch (error: Throwable) {
            throw rollback("save", error, previous) {
                if (installed) fileSystem.deleteRecursively(target)
                if (backedUp) fileSystem.replaceDirectory(backup, target)
            }
        }
        if (backedUp) runCatching { fileSystem.deleteRecursively(backup) }
    }

    fun deletePetAndSnapshot(id: String, snapshotJson: String) {
        AndroidStateValidator.requireSafePetId(id)
        AndroidStateValidator.validateSnapshot(snapshotJson)
        val previous = readSnapshot()
        val target = petDirectory(id)
        val backup = fileSystem.createTemporarySibling(target)
        var backedUp = false
        try {
            if (fileSystem.exists(target)) {
                fileSystem.replaceDirectory(target, backup)
                backedUp = true
            }
            writeSnapshot(snapshotJson)
        } catch (error: Throwable) {
            throw rollback("delete", error, previous) {
                if (backedUp) fileSystem.replaceDirectory(backup, target)
            }
        }
        if (backedUp) runCatching { fileSystem.deleteRecursively(backup) }
    }

    private fun rollback(operation: String, cause: Throwable, previous: String?, restoreAssets: () -> Unit): IOException {
        val recoveryErrors = mutableListOf<Throwable>()
        try { restoreAssets() } catch (error: Throwable) { recoveryErrors += error }
        try {
            if (previous == null) clearSnapshot() else writeSnapshot(previous)
        } catch (error: Throwable) {
            recoveryErrors += error
        }
        val state = if (recoveryErrors.isEmpty()) "complete" else "failed"
        return IOException("$operation transaction failed; recovery=$state", cause).also { failure ->
            recoveryErrors.forEach(failure::addSuppressed)
        }
    }

    private fun petDirectory(id: String) = File(File(filesDir, "pets"), id)
}
