package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidStateCoordinatorTest {
    @Test
    fun cleanInstallHasNoSnapshot() {
        val coordinator = fixture().coordinator

        assertNull(coordinator.loadSnapshot())
    }

    @Test
    fun delegatesSettingsHistoryAndSelectionMutationsToPersistentState() {
        val fixture = fixture()
        fixture.coordinator.saveSettings(SETTINGS)
        fixture.coordinator.appendHistory(EVENT)
        fixture.coordinator.savePet("momo", petMetadata("momo", "Momo"), "bW9tbw==")
        fixture.coordinator.selectPet("momo")

        val snapshot = JSONObject(fixture.coordinator.loadSnapshot()!!)
        assertEquals(SETTINGS, snapshot.getString("settingsJson"))
        assertEquals(EVENT, snapshot.getJSONArray("historyJson").getString(0))
        assertEquals("momo", snapshot.getJSONObject("overlay").getJSONObject("activePet").getString("id"))

        fixture.coordinator.replaceHistory(listOf(replacementEvent()))
        fixture.coordinator.clearHistory()
        assertEquals(0, JSONObject(fixture.coordinator.loadSnapshot()!!).getJSONArray("historyJson").length())
        fixture.coordinator.clearSettings()
        assertNull(fixture.coordinator.loadSnapshot())
    }

    @Test
    fun saveSnapshotFailureRestoresPreviousSnapshotAndAssetDirectory() {
        val fixture = fixtureWithPets("momo")
        val previous = fixture.store.readSnapshot()
        val previousAsset = fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp")
        fixture.fileSystem.failNextAtomicWrite()

        assertThrows(IOException::class.java) {
            fixture.coordinator.savePet("momo", petMetadata("momo", "New Momo"), "bmV3")
        }

        assertEquals(previous, fixture.store.readSnapshot())
        assertArrayEquals(previousAsset, fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp"))
    }

    @Test
    fun saveFailureOnCleanInstallRestoresUninitializedStateAndNoAsset() {
        val fixture = fixture()
        fixture.fileSystem.failNextAtomicWrite()

        assertThrows(IOException::class.java) {
            fixture.coordinator.savePet("momo", petMetadata("momo", "Momo"), "bmV3")
        }

        assertNull(fixture.store.readSnapshot())
        assertNull(fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp"))
    }

    @Test
    fun saveAssetFailureDoesNotChangePreviousSnapshotOrAsset() {
        val fixture = fixtureWithPets("momo")
        val previous = fixture.store.readSnapshot()
        val previousAsset = fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp")
        fixture.fileSystem.failNextAssetWrite()

        assertThrows(IOException::class.java) {
            fixture.coordinator.savePet("momo", petMetadata("momo", "New Momo"), "bmV3")
        }

        assertEquals(previous, fixture.store.readSnapshot())
        assertArrayEquals(previousAsset, fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp"))
    }

    @Test
    fun deleteSnapshotFailureRestoresPreviousSnapshotAndAssetDirectory() {
        val fixture = fixtureWithPets("momo")
        val previous = fixture.store.readSnapshot()
        val previousAsset = fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp")
        fixture.fileSystem.failNextAtomicWrite()

        assertThrows(IOException::class.java) { fixture.coordinator.deletePet("momo") }

        assertEquals(previous, fixture.store.readSnapshot())
        assertArrayEquals(previousAsset, fixture.fileSystem.readBytes("/state/pets/momo/spritesheet.webp"))
    }

    @Test
    fun deletingInactivePetPreservesActivePet() {
        val fixture = fixtureWithPets("momo", "lulu")

        fixture.coordinator.deletePet("lulu")

        val snapshot = JSONObject(fixture.store.readSnapshot()!!)
        assertEquals("momo", snapshot.getJSONObject("overlay").getJSONObject("activePet").getString("id"))
        assertEquals(1, snapshot.getJSONArray("pets").length())
        assertFalse(fixture.fileSystem.hasPath("/state/pets/lulu"))
    }

    private fun fixture(): Fixture {
        val fileSystem = MemoryStateFileSystem()
        val store = AndroidStateStore(File("/state"), fileSystem)
        return Fixture(fileSystem, store, AndroidStateCoordinator(store))
    }

    private fun fixtureWithPets(vararg ids: String): Fixture {
        val fixture = fixture()
        ids.forEach { id -> fixture.store.writePet(id, petMetadata(id, id.replaceFirstChar(Char::uppercase)), "b2xk") }
        fixture.store.writeSnapshot(snapshot(ids.toList(), activePetId = ids.first()))
        return fixture
    }

    private data class Fixture(
        val fileSystem: MemoryStateFileSystem,
        val store: AndroidStateStore,
        val coordinator: AndroidStateCoordinator,
    )

    companion object {
        private const val SETTINGS = """{"schemaVersion":5}"""
        private const val EVENT = """{"id":"event-1","action":"completed","occurredAt":100}"""

        private fun replacementEvent() = """{"id":"event-2","action":"skipped","occurredAt":200}"""
        private fun petMetadata(id: String, displayName: String) =
            """{"id":"$id","displayName":"$displayName","spriteVersion":2,"spritesheetFilename":"$id.webp","importedAt":10,"updatedAt":20}"""

        private fun petAsset(id: String) =
            """{"id":"$id","metadataJson":${JSONObject.quote(petMetadata(id, id.replaceFirstChar(Char::uppercase)))},"assetPath":"pets/$id/spritesheet.webp","spritesheetBase64":"b2xk"}"""

        private fun snapshot(ids: List<String>, activePetId: String? = null): String {
            val pets = ids.joinToString(",") { petAsset(it) }
            val active = activePetId?.let { ",\"activePet\":${petAsset(it)}" }.orEmpty()
            return """{"schemaVersion":1,"settingsJson":"{\"schemaVersion\":5}","historyJson":[],"pets":[$pets],"overlay":{"xRatio":0.5,"yRatio":0.5$active}}"""
        }
    }
}

private class MemoryStateFileSystem : StateFileSystem {
    private val textFiles = mutableMapOf<String, String>()
    private val binaryFiles = mutableMapOf<String, ByteArray>()
    private val directories = mutableSetOf<String>()
    private var temporarySequence = 0
    private var shouldFailAtomicWrite = false
    private var shouldFailAssetWrite = false

    fun failNextAtomicWrite() { shouldFailAtomicWrite = true }
    fun failNextAssetWrite() { shouldFailAssetWrite = true }
    fun readBytes(path: String): ByteArray? = binaryFiles[path]
    fun hasPath(path: String): Boolean = directories.any { it == path || it.startsWith("$path/") }
        || binaryFiles.keys.any { it.startsWith("$path/") }

    override fun readText(file: File): String? = textFiles[file.path]

    override fun writeAtomically(file: File, value: String) {
        if (shouldFailAtomicWrite) {
            shouldFailAtomicWrite = false
            throw IOException("atomic write failed")
        }
        textFiles[file.path] = value
    }

    override fun exists(file: File): Boolean = hasPath(file.path)

    override fun createTemporarySibling(target: File): File {
        temporarySequence += 1
        return File(target.parentFile, ".${target.name}.$temporarySequence.tmp").also { directories += it.path }
    }

    override fun writeFile(file: File, value: ByteArray) {
        if (shouldFailAssetWrite) {
            shouldFailAssetWrite = false
            throw IOException("asset write failed")
        }
        directories += file.parentFile!!.path
        binaryFiles[file.path] = value.copyOf()
    }

    override fun replaceDirectory(temporary: File, target: File) {
        val sourcePrefix = "${temporary.path}/"
        val files = binaryFiles.filterKeys { it.startsWith(sourcePrefix) }
        if (!directories.contains(temporary.path) && files.isEmpty()) throw IOException("source directory missing")
        deletePath(target.path)
        files.forEach { (path, bytes) -> binaryFiles["${target.path}/${path.removePrefix(sourcePrefix)}"] = bytes }
        binaryFiles.keys.filter { it.startsWith(sourcePrefix) }.toList().forEach(binaryFiles::remove)
        directories.removeAll { it == temporary.path || it.startsWith(sourcePrefix) }
        directories += target.path
    }

    override fun deleteRecursively(file: File) {
        textFiles.remove(file.path)
        deletePath(file.path)
    }

    private fun deletePath(path: String) {
        val prefix = "$path/"
        binaryFiles.keys.filter { it == path || it.startsWith(prefix) }.toList().forEach(binaryFiles::remove)
        directories.removeAll { it == path || it.startsWith(prefix) }
    }
}
