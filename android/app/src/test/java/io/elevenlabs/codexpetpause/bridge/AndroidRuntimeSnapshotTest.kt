package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidRuntimeSnapshotTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun legacySnapshotWithoutRuntimeRevisionLoadsAsRevisionZero() {
        val coordinator = coordinatorWithSnapshot(snapshotJson())

        val runtime = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))

        assertEquals(1, runtime.getInt("schemaVersion"))
        assertEquals(0L, runtime.getLong("revision"))
    }

    @Test
    fun reminderRuntimeMutationsIncreaseThePersistedRevisionMonotonically() {
        val coordinator = coordinatorWithSnapshot(snapshotJson())

        coordinator.saveReminderSettings(settingsJson())
        val first = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot())).getLong("revision")
        coordinator.commitReminderAction(
            settingsJson(),
            JSONObject()
                .put("id", "event-2")
                .put("reminderId", "lookAway")
                .put("reminderType", "lookAway")
                .put("action", "completed")
                .put("occurredAt", 2_000L)
                .toString(),
        )
        val second = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot())).getLong("revision")

        assertEquals(1L, first)
        assertEquals(2L, second)
    }

    @Test
    fun runtimeSnapshotContainsSchedulerStateWithoutPetPayloads() {
        val largeBase64 = Base64.getEncoder().encodeToString(ByteArray(4_096) { 42 })
        val coordinator = coordinatorWithSnapshot(snapshotJson(largeBase64))

        val runtime = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))
        val serialized = runtime.toString()

        assertEquals(settingsJson(), runtime.getString("settingsJson"))
        assertEquals(1, runtime.getJSONArray("historyJson").length())
        assertFalse(runtime.has("runtimeRevision"))
        assertFalse(runtime.has("pets"))
        assertFalse(runtime.has("overlay"))
        assertFalse(serialized.contains("spritesheetBase64"))
        assertFalse(serialized.contains(largeBase64))
        assertTrue(serialized.length < largeBase64.length)
    }

    @Test
    fun runtimeLoaderDoesNotValidateOrDecodePetPayloads() {
        val invalidPetPayload = "not-canonical-base64%%%"
        val fileSystem = ReadOnlySnapshotFileSystem(snapshotJson(invalidPetPayload))
        val coordinator = AndroidStateCoordinator(
            AndroidStateStore(File("/state"), fileSystem),
        )

        val runtime = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))

        assertEquals(0L, runtime.getLong("revision"))
        assertFalse(runtime.toString().contains(invalidPetPayload))
    }

    private fun coordinatorWithSnapshot(snapshot: String): AndroidStateCoordinator {
        val store = AndroidStateStore(temporaryFolder.newFolder())
        store.writeSnapshot(snapshot)
        return AndroidStateCoordinator(store)
    }

    private fun snapshotJson(spritesheetBase64: String = "YQ=="): String {
        val pets = JSONArray()
            .put(petAsset("momo", "00000000000000000000000000000001", spritesheetBase64))
            .put(petAsset("luna", "00000000000000000000000000000002", spritesheetBase64))
        return JSONObject()
            .put("schemaVersion", 1)
            .put("settingsJson", settingsJson())
            .put("historyJson", JSONArray().put(historyJson()))
            .put("pets", pets)
            .put(
                "overlay",
                JSONObject()
                    .put("xRatio", 0.82)
                    .put("yRatio", 0.72)
                    .put("activePet", pets.getJSONObject(0)),
            )
            .toString()
    }

    private fun petAsset(id: String, revision: String, spritesheetBase64: String) = JSONObject()
        .put("id", id)
        .put(
            "metadataJson",
            JSONObject()
                .put("id", id)
                .put("displayName", id.replaceFirstChar(Char::uppercase))
                .put("spriteVersion", 2)
                .put("spritesheetFilename", "$id.webp")
                .put("importedAt", 10)
                .put("updatedAt", 20)
                .toString(),
        )
        .put("assetPath", "pets/$id/$revision/spritesheet.webp")
        .put("spritesheetBase64", spritesheetBase64)

    private fun historyJson() = JSONObject()
        .put("id", "event-1")
        .put("reminderId", "lookAway")
        .put("reminderType", "lookAway")
        .put("action", "completed")
        .put("occurredAt", 1_000L)
        .toString()

    private fun settingsJson() = JSONObject()
        .put("schemaVersion", 5)
        .put("locale", "en")
        .put("onboardingComplete", true)
        .put("theme", "system")
        .put("petSize", "medium")
        .put("soundEnabled", true)
        .put("animationsEnabled", true)
        .put("affinity", 0)
        .put("quietHours", JSONObject().put("enabled", false).put("startMinutes", 1320).put("endMinutes", 420))
        .put("runtime", JSONObject())
        .put("cat", JSONObject().put("name", "Momo"))
        .put("activePetId", "builtin-cat")
        .put("petPosition", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))
        .put(
            "reminders",
            JSONArray()
                .put(preset("lookAway", 1_000L, 20, true))
                .put(preset("drinkWater", 2_700_000L, 45, false))
                .put(preset("standUp", 3_600_000L, 60, false))
                .put(preset("takeBreak", 5_400_000L, 90, false)),
        )
        .toString()

    private fun preset(type: String, nextDueAt: Long, intervalMinutes: Int, enabled: Boolean) = JSONObject()
        .put("id", type)
        .put("kind", "preset")
        .put("type", type)
        .put("enabled", enabled)
        .put("intervalMinutes", intervalMinutes)
        .put("nextDueAt", nextDueAt)
        .put("status", if (enabled) "scheduled" else "disabled")
}

private class ReadOnlySnapshotFileSystem(
    private val snapshot: String,
) : StateFileSystem by AndroidStateFileSystem() {
    override fun readText(file: File): String = snapshot
}
