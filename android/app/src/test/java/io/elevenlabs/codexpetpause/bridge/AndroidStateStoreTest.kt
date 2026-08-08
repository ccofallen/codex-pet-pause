package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.io.IOException
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue

class AndroidStateStoreTest {
    @Test
    fun failedReplacementKeepsPreviousState() {
        val fileSystem = FailingStateFileSystem()
        val store = AndroidStateStore(File("/state"), fileSystem)
        val validSnapshot = snapshot(SETTINGS)
        val replacement = snapshot(SETTINGS.replace("\"theme\":\"system\"", "\"theme\":\"dark\""))

        store.writeSnapshot(validSnapshot)
        fileSystem.failNextAtomicWrite()

        assertThrows(IOException::class.java) { store.writeSnapshot(replacement) }
        assertEquals(validSnapshot, store.readSnapshot())
    }

    @Test
    fun rejectsDangerousPetIdsBeforeCreatingAssetDirectories() {
        val fileSystem = FailingStateFileSystem()
        val store = AndroidStateStore(File("/state"), fileSystem)

        assertThrows(IllegalArgumentException::class.java) {
            store.writePetVersion("../escape", REVISION, petMetadata("escape"), "c3ByaXRl")
        }

        assertTrue(fileSystem.createdDirectories.isEmpty())
    }

    @Test
    fun rejectsNestedSchemaMarkersInsteadOfSearchingSnapshotText() {
        val store = AndroidStateStore(File("/state"), FailingStateFileSystem())

        assertThrows(Exception::class.java) {
            store.writeSnapshot("""{"nested":{"schemaVersion":1}}""")
        }
    }

    @Test
    fun rejectsMalformedMetadataAndNonCanonicalBase64BeforeWritingAssets() {
        val fileSystem = FailingStateFileSystem()
        val store = AndroidStateStore(File("/state"), fileSystem)

        assertThrows(IllegalArgumentException::class.java) {
            store.writePetVersion("momo", REVISION, "{not-json}", "c3ByaXRl")
        }
        assertThrows(IllegalArgumentException::class.java) {
            store.writePetVersion("momo", REVISION, petMetadata("momo"), "AB==")
        }
        assertTrue(fileSystem.createdDirectories.isEmpty())
    }

    @Test
    fun rejectsUnsafeRevisionAndIncompleteSettingsShape() {
        val store = AndroidStateStore(File("/state"), FailingStateFileSystem())

        assertThrows(IllegalArgumentException::class.java) {
            store.writePetVersion("momo", "../revision", petMetadata("momo"), "c3ByaXRl")
        }
        assertThrows(Exception::class.java) { store.writeSnapshot(snapshot("""{"schemaVersion":5}""")) }
        assertThrows(Exception::class.java) {
            store.writeSnapshot(snapshot(SETTINGS.replace("\"theme\":\"system\"", "\"theme\":\"neon\"")))
        }
        assertThrows(Exception::class.java) {
            store.writeSnapshot(snapshot(SETTINGS.replace(REMINDERS, "[]")))
        }
        assertThrows(Exception::class.java) {
            store.writeSnapshot(snapshot(SETTINGS.replace("\"runtime\":{}", "\"runtime\":{\"quietStartedAt\":null}")))
        }
    }

    companion object {
        private const val REVISION = "0123456789abcdef0123456789abcdef"
        private const val REMINDERS = """[{"id":"lookAway","kind":"preset","type":"lookAway","enabled":false,"intervalMinutes":20,"nextDueAt":1200000,"status":"disabled"},{"id":"drinkWater","kind":"preset","type":"drinkWater","enabled":false,"intervalMinutes":45,"nextDueAt":2700000,"status":"disabled"},{"id":"standUp","kind":"preset","type":"standUp","enabled":false,"intervalMinutes":60,"nextDueAt":3600000,"status":"disabled"},{"id":"takeBreak","kind":"preset","type":"takeBreak","enabled":false,"intervalMinutes":90,"nextDueAt":5400000,"status":"disabled"}]"""
        private const val SETTINGS = """{"schemaVersion":5,"locale":"en","onboardingComplete":false,"theme":"system","petSize":"medium","soundEnabled":false,"animationsEnabled":true,"affinity":0,"quietHours":{"enabled":false,"startMinutes":1320,"endMinutes":420},"runtime":{},"cat":{"name":"Momo"},"activePetId":"builtin-cat","petPosition":{"xRatio":0.82,"yRatio":0.72},"reminders":$REMINDERS}"""
        private fun petMetadata(id: String) = """{"id":"$id","displayName":"Momo","spriteVersion":2,"spritesheetFilename":"momo.webp","importedAt":10,"updatedAt":20}"""
        private fun snapshot(settings: String) = """{"schemaVersion":1,"settingsJson":${org.json.JSONObject.quote(settings)},"historyJson":[],"pets":[],"overlay":{"xRatio":0.5,"yRatio":0.5}}"""
    }
}

private class FailingStateFileSystem : StateFileSystem {
    private var state: String? = null
    private var shouldFailAtomicWrite = false
    val createdDirectories = mutableListOf<File>()

    fun failNextAtomicWrite() {
        shouldFailAtomicWrite = true
    }

    override fun readText(file: File): String? = state

    override fun writeAtomically(file: File, value: String) {
        if (shouldFailAtomicWrite) {
            shouldFailAtomicWrite = false
            throw IOException("atomic move failed")
        }
        state = value
    }

    override fun exists(file: File): Boolean = false

    override fun listChildren(directory: File): List<File> = emptyList()

    override fun createTemporarySibling(target: File): File {
        return File(target.parentFile, ".${target.name}.tmp").also(createdDirectories::add)
    }

    override fun writeFile(file: File, value: ByteArray) = Unit

    override fun replaceDirectory(temporary: File, target: File) = Unit

    override fun deleteRecursively(file: File) = Unit
}
