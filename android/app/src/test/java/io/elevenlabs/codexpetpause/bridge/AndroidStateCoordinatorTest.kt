package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidStateCoordinatorTest {
    @Test
    fun cleanInstallHasNoSnapshot() {
        assertNull(fixture().coordinator.loadSnapshot())
    }

    @Test
    fun sameIdSnapshotFailureNeverChangesOldPathOrBytes() {
        val fixture = fixtureWithPets("momo")
        val previous = fixture.store.readSnapshot()
        val oldPath = assetPath(JSONObject(previous!!).getJSONArray("pets").getJSONObject(0))
        val oldBytes = fixture.fileSystem.readBytes(oldPath)
        fixture.fileSystem.failNextAtomicWrite()
        fixture.fileSystem.failNextDelete()

        assertThrows(IOException::class.java) {
            fixture.coordinator.savePet("momo", petMetadata("momo", "New Momo"), "bmV3")
        }

        val stored = JSONObject(fixture.store.readSnapshot()!!)
        assertEquals(oldPath, assetPath(stored.getJSONArray("pets").getJSONObject(0)))
        assertArrayEquals(oldBytes, fixture.fileSystem.readBytes(oldPath))
        assertArrayEquals("new".toByteArray(), fixture.fileSystem.readBytes("pets/momo/$NEW_REVISION/spritesheet.webp"))
    }

    @Test
    fun cleanInstallSnapshotFailureLeavesOnlyAnUnreferencedVersion() {
        val fixture = fixture()
        fixture.fileSystem.failNextAtomicWrite()
        fixture.fileSystem.failNextDelete()

        assertThrows(IOException::class.java) {
            fixture.coordinator.savePet("momo", petMetadata("momo", "Momo"), "bmV3")
        }

        assertNull(fixture.store.readSnapshot())
        assertArrayEquals("new".toByteArray(), fixture.fileSystem.readBytes("pets/momo/$NEW_REVISION/spritesheet.webp"))
    }

    @Test
    fun successfulReplacementIgnoresOldVersionCleanupFailure() {
        val fixture = fixtureWithPets("momo")
        val oldSnapshot = JSONObject(fixture.store.readSnapshot()!!)
        val oldPath = assetPath(oldSnapshot.getJSONArray("pets").getJSONObject(0))
        fixture.fileSystem.failNextDelete()

        fixture.coordinator.savePet("momo", petMetadata("momo", "New Momo"), "bmV3")

        val stored = JSONObject(fixture.store.readSnapshot()!!)
        assertEquals("pets/momo/$NEW_REVISION/spritesheet.webp", assetPath(stored.getJSONArray("pets").getJSONObject(0)))
        assertEquals("pets/momo/$NEW_REVISION/spritesheet.webp", assetPath(stored.getJSONObject("overlay").getJSONObject("activePet")))
        assertArrayEquals("new".toByteArray(), fixture.fileSystem.readBytes("pets/momo/$NEW_REVISION/spritesheet.webp"))
        assertArrayEquals("old".toByteArray(), fixture.fileSystem.readBytes(oldPath))
    }

    @Test
    fun persistValidatedPetCommitsImmutableAssetsAndActiveStateTogether() {
        val fixture = fixture()
        fixture.store.writeSnapshot(snapshot(emptyList(), null))

        fixture.coordinator.persistValidatedPet("momo", petMetadata("momo", "Momo"), "bmV3")

        val stored = JSONObject(fixture.store.readSnapshot()!!)
        val pet = stored.getJSONArray("pets").getJSONObject(0)
        assertEquals("momo", pet.getString("id"))
        assertEquals(assetPath(pet), assetPath(stored.getJSONObject("overlay").getJSONObject("activePet")))
        assertEquals("momo", JSONObject(stored.getString("settingsJson")).getString("activePetId"))
        assertArrayEquals(
            "new".toByteArray(),
            fixture.fileSystem.readBytes("pets/momo/$NEW_REVISION/spritesheet.webp"),
        )
    }

    @Test
    fun failedValidatedPetCommitKeepsThePreviousActivePet() {
        val fixture = fixture()
        fixture.store.writeSnapshot(snapshot(emptyList(), null))
        val previous = fixture.store.readSnapshot()
        fixture.fileSystem.failNextAtomicWrite()

        assertThrows(IOException::class.java) {
            fixture.coordinator.persistValidatedPet("momo", petMetadata("momo", "Momo"), "bmV3")
        }

        assertEquals(previous, fixture.store.readSnapshot())
        assertFalse(fixture.fileSystem.hasPath("/state/pets/momo/$NEW_REVISION"))
    }

    @Test
    fun deleteCommitsReferenceRemovalBeforeBestEffortAssetCleanup() {
        val fixture = fixtureWithPets("momo")
        val oldPath = assetPath(JSONObject(fixture.store.readSnapshot()!!).getJSONArray("pets").getJSONObject(0))
        fixture.fileSystem.failNextDelete()

        fixture.coordinator.deletePet("momo")

        val stored = JSONObject(fixture.store.readSnapshot()!!)
        assertEquals(0, stored.getJSONArray("pets").length())
        assertFalse(stored.getJSONObject("overlay").has("activePet"))
        assertArrayEquals("old".toByteArray(), fixture.fileSystem.readBytes(oldPath))
    }

    @Test
    fun clearOperationsConvergeInEveryOrderAndRemoveUnindexedPetDirectories() {
        val operations = listOf("settings", "history", "pets")
        permutations(operations).forEach { order ->
            val fixture = fixtureWithPets("momo")
            fixture.store.writePetVersion("orphan", ORPHAN_REVISION, petMetadata("orphan", "Orphan"), "b3JwaGFu")

            order.forEach { operation ->
                when (operation) {
                    "settings" -> fixture.coordinator.clearSettings()
                    "history" -> fixture.coordinator.clearHistory()
                    else -> fixture.coordinator.clearPets()
                }
            }

            assertCleared(fixture)
            assertFalse(fixture.fileSystem.hasPath("/state/pets"))
        }
    }

    @Test
    fun concurrentClearMutationsUseOneCoordinatorLock() {
        val fixture = fixtureWithPets("momo")
        fixture.fileSystem.writeDelayMillis = 30
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(3)
        val futures = listOf(
            executor.submit { start.await(); fixture.coordinator.clearSettings() },
            executor.submit { start.await(); fixture.coordinator.clearHistory() },
            executor.submit { start.await(); fixture.coordinator.clearPets() },
        )

        start.countDown()
        futures.forEach { it.get(5, TimeUnit.SECONDS) }
        executor.shutdownNow()

        assertCleared(fixture)
        assertEquals(1, fixture.fileSystem.maximumConcurrentWrites.get())
    }

    private fun assertCleared(fixture: Fixture) {
        val snapshot = JSONObject(fixture.store.readSnapshot()!!)
        assertTrue(snapshot.isNull("settingsJson"))
        assertEquals(0, snapshot.getJSONArray("historyJson").length())
        assertEquals(0, snapshot.getJSONArray("pets").length())
        assertFalse(snapshot.getJSONObject("overlay").has("activePet"))
    }

    private fun fixture(): Fixture {
        val fileSystem = MemoryStateFileSystem()
        val revisions = SequenceRevisionTokenSource(NEW_REVISION, "00000000000000000000000000000003")
        val store = AndroidStateStore(File("/state"), fileSystem, revisions)
        return Fixture(fileSystem, store, AndroidStateCoordinator(store))
    }

    private fun fixtureWithPets(vararg ids: String): Fixture {
        val fixture = fixture()
        val assets = ids.mapIndexed { index, id ->
            val revision = (index + 1).toString(16).padStart(32, '0')
            val path = fixture.store.writePetVersion(id, revision, petMetadata(id, id.replaceFirstChar(Char::uppercase)), "b2xk")
            petAsset(id, path, "b2xk")
        }
        fixture.store.writeSnapshot(snapshot(assets, ids.firstOrNull()))
        return fixture
    }

    private data class Fixture(
        val fileSystem: MemoryStateFileSystem,
        val store: AndroidStateStore,
        val coordinator: AndroidStateCoordinator,
    )

    companion object {
        private const val NEW_REVISION = "00000000000000000000000000000002"
        private const val ORPHAN_REVISION = "0000000000000000000000000000000f"
        private const val EVENT = """{"id":"event-1","action":"completed","occurredAt":100}"""
        private const val REMINDERS = """[{"id":"lookAway","kind":"preset","type":"lookAway","enabled":false,"intervalMinutes":20,"nextDueAt":1200000,"status":"disabled"},{"id":"drinkWater","kind":"preset","type":"drinkWater","enabled":false,"intervalMinutes":45,"nextDueAt":2700000,"status":"disabled"},{"id":"standUp","kind":"preset","type":"standUp","enabled":false,"intervalMinutes":60,"nextDueAt":3600000,"status":"disabled"},{"id":"takeBreak","kind":"preset","type":"takeBreak","enabled":false,"intervalMinutes":90,"nextDueAt":5400000,"status":"disabled"}]"""
        private const val SETTINGS = """{"schemaVersion":5,"locale":"en","onboardingComplete":false,"theme":"system","petSize":"medium","soundEnabled":false,"animationsEnabled":true,"affinity":0,"quietHours":{"enabled":false,"startMinutes":1320,"endMinutes":420},"runtime":{},"cat":{"name":"Momo"},"activePetId":"builtin-cat","petPosition":{"xRatio":0.82,"yRatio":0.72},"reminders":$REMINDERS}"""

        private fun petMetadata(id: String, displayName: String) =
            """{"id":"$id","displayName":"$displayName","spriteVersion":2,"spritesheetFilename":"$id.webp","importedAt":10,"updatedAt":20}"""

        private fun petAsset(id: String, path: String, base64: String) = JSONObject()
            .put("id", id)
            .put("metadataJson", petMetadata(id, id.replaceFirstChar(Char::uppercase)))
            .put("assetPath", path)
            .put("spritesheetBase64", base64)

        private fun snapshot(pets: List<JSONObject>, activePetId: String?): String {
            val petArray = org.json.JSONArray(pets)
            val overlay = JSONObject().put("xRatio", 0.5).put("yRatio", 0.5)
            pets.firstOrNull { it.getString("id") == activePetId }?.let { overlay.put("activePet", it) }
            return JSONObject()
                .put("schemaVersion", 1)
                .put("settingsJson", SETTINGS)
                .put("historyJson", org.json.JSONArray().put(EVENT))
                .put("pets", petArray)
                .put("overlay", overlay)
                .toString()
        }

        private fun assetPath(pet: JSONObject): String = pet.getString("assetPath")

        private fun <T> permutations(values: List<T>): List<List<T>> = if (values.isEmpty()) listOf(emptyList()) else
            values.flatMap { value -> permutations(values - value).map { listOf(value) + it } }
    }
}

private class SequenceRevisionTokenSource(vararg values: String) : RevisionTokenSource {
    private val revisions = ArrayDeque(values.toList())
    override fun nextRevision(): String = revisions.removeFirst()
}

private class MemoryStateFileSystem : StateFileSystem {
    private val textFiles = ConcurrentHashMap<String, String>()
    private val binaryFiles = ConcurrentHashMap<String, ByteArray>()
    private val directories = ConcurrentHashMap.newKeySet<String>()
    private val temporarySequence = AtomicInteger()
    private val activeWrites = AtomicInteger()
    val maximumConcurrentWrites = AtomicInteger()
    @Volatile var writeDelayMillis = 0L
    @Volatile private var shouldFailAtomicWrite = false
    @Volatile private var shouldFailDelete = false

    fun failNextAtomicWrite() { shouldFailAtomicWrite = true }
    fun failNextDelete() { shouldFailDelete = true }
    fun readBytes(assetPath: String): ByteArray? = binaryFiles["/state/$assetPath"]?.copyOf()
    fun hasPath(path: String): Boolean = textFiles.containsKey(path)
        || directories.any { it == path || it.startsWith("$path/") }
        || binaryFiles.keys.any { it == path || it.startsWith("$path/") }

    override fun readText(file: File): String? = textFiles[file.path]

    override fun writeAtomically(file: File, value: String) {
        val concurrent = activeWrites.incrementAndGet()
        maximumConcurrentWrites.accumulateAndGet(concurrent, ::maxOf)
        try {
            if (writeDelayMillis > 0) Thread.sleep(writeDelayMillis)
            if (shouldFailAtomicWrite) {
                shouldFailAtomicWrite = false
                throw IOException("atomic write failed")
            }
            textFiles[file.path] = value
        } finally {
            activeWrites.decrementAndGet()
        }
    }

    override fun exists(file: File): Boolean = hasPath(file.path)

    override fun listChildren(directory: File): List<File> {
        val prefix = "${directory.path}/"
        return (directories.asSequence() + binaryFiles.keys.asSequence())
            .filter { it.startsWith(prefix) }
            .map { File(directory, it.removePrefix(prefix).substringBefore('/')) }
            .distinctBy(File::getPath)
            .toList()
    }

    override fun createTemporarySibling(target: File): File =
        File(target.parentFile, ".${target.name}.${temporarySequence.incrementAndGet()}.tmp").also { directories += it.path }

    override fun writeFile(file: File, value: ByteArray) {
        directories += file.parentFile!!.path
        binaryFiles[file.path] = value.copyOf()
    }

    override fun replaceDirectory(temporary: File, target: File) {
        if (exists(target)) throw IOException("immutable target exists")
        val sourcePrefix = "${temporary.path}/"
        val files = binaryFiles.filterKeys { it.startsWith(sourcePrefix) }
        if (!directories.contains(temporary.path) && files.isEmpty()) throw IOException("source directory missing")
        files.forEach { (path, bytes) -> binaryFiles["${target.path}/${path.removePrefix(sourcePrefix)}"] = bytes }
        binaryFiles.keys.filter { it.startsWith(sourcePrefix) }.forEach(binaryFiles::remove)
        directories.removeAll { it == temporary.path || it.startsWith(sourcePrefix) }
        directories += target.path
    }

    override fun deleteRecursively(file: File) {
        if (shouldFailDelete) {
            shouldFailDelete = false
            throw IOException("delete failed")
        }
        val prefix = "${file.path}/"
        textFiles.remove(file.path)
        binaryFiles.keys.filter { it == file.path || it.startsWith(prefix) }.forEach(binaryFiles::remove)
        directories.removeAll { it == file.path || it.startsWith(prefix) }
    }
}
