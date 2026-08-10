package io.elevenlabs.codexpetpause

import android.util.Base64
import android.util.Log
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PetCatalogStressTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
        DeviceQa.seedState()
    }

    @After
    fun tearDown() {
        DeviceQa.stopService()
    }

    @Test
    fun repeatedPetPageAndSelectionCyclesRemainWithinPssBoundaries() {
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        importStandardPets(coordinator)

        val runtimePayload = requireNotNull(coordinator.loadRuntimeSnapshot())
        val catalogPayload = requireNotNull(coordinator.loadPetCatalog())
        assertTrue("runtime payload was ${runtimePayload.toByteArray().size} bytes", runtimePayload.toByteArray().size < 128 * 1024)
        assertFalse(runtimePayload.contains("spritesheetBase64"))
        assertFalse(catalogPayload.contains("spritesheetBase64"))
        assertTrue(JSONObject(catalogPayload).getJSONArray("pets").length() == PET_COUNT)

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            DeviceQa.awaitText("Phone navigation", "手机导航")
            DeviceQa.clickText("Companion", "陪伴")
            runPetCycle(scenario, 0)
            DeviceQa.stabilizeMemory()
            val warmBaseline = DeviceQa.currentPssBytes()
            val readings = mutableListOf<Long>()

            repeat(STRESS_CYCLES) { cycle ->
                runPetCycle(scenario, cycle)
                DeviceQa.stabilizeMemory()
                readings += DeviceQa.currentPssBytes()
            }

            val finalPss = readings.last()
            val delta = finalPss - warmBaseline
            Log.i(TAG, "PSS warmBaseline=$warmBaseline cycles=${readings.joinToString(",")} final=$finalPss delta=$delta")

            val monotonicallyGrowing = readings.size > 1 && readings.zipWithNext().all { (before, after) -> after > before }
            assertFalse("PSS grew monotonically across all cycles: $readings", monotonicallyGrowing)
            assertTrue("final PSS delta $delta exceeded $MAX_DELTA_BYTES", delta <= MAX_DELTA_BYTES)
            assertTrue("final PSS $finalPss reached $ABSOLUTE_PSS_LIMIT_BYTES", finalPss < ABSOLUTE_PSS_LIMIT_BYTES)
            assertFalse("ANR observed during stress", DeviceQa.hasObservedAnr())
            assertFalse("process death observed during stress", DeviceQa.hasObservedProcessDeath())
        }
    }

    private fun runPetCycle(scenario: ActivityScenario<MainActivity>, cycle: Int) {
        val selectedId = "stress-pet-${cycle % PET_COUNT + 1}"
        val selectedName = "Stress Pet ${cycle % PET_COUNT + 1}"
        DeviceQa.clickText("Pet", "宠物")
        DeviceQa.awaitText("Stress Pet 1")
        DeviceQa.clickWebButton(scenario, "Use Momo", "使用 Momo")
        DeviceQa.awaitCondition("built-in selection did not commit") { activePetId() == "builtin-cat" }
        DeviceQa.clickWebButton(scenario, "Use $selectedName", "使用 $selectedName")
        DeviceQa.awaitCondition("$selectedId selection did not commit") { activePetId() == selectedId }
        DeviceQa.clickText("Companion", "陪伴")
        DeviceQa.awaitCondition("pet page did not unmount") {
            DeviceQa.webText(scenario, "android-companion").isNotBlank()
        }
    }

    private fun importStandardPets(coordinator: AndroidStateCoordinator) {
        val atlas = Base64.encodeToString(DeviceQa.testAsset("task9-valid-pet.webp"), Base64.NO_WRAP)
        repeat(PET_COUNT) { index ->
            val number = index + 1
            val id = "stress-pet-$number"
            val timestamp = System.currentTimeMillis() + number
            val metadata = JSONObject()
                .put("id", id)
                .put("displayName", "Stress Pet $number")
                .put("spriteVersion", 2)
                .put("spritesheetFilename", "$id.webp")
                .put("importedAt", timestamp)
                .put("updatedAt", timestamp)
            coordinator.persistValidatedPet(id, metadata.toString(), atlas)
        }
    }

    private fun activePetId(): String {
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val runtime = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))
        return JSONObject(runtime.getString("settingsJson")).getString("activePetId")
    }

    companion object {
        private const val TAG = "PetCatalogStressTest"
        private const val PET_COUNT = 3
        private const val STRESS_CYCLES = 8
        private const val MAX_DELTA_BYTES = 64L * 1024L * 1024L
        private const val ABSOLUTE_PSS_LIMIT_BYTES = 256L * 1024L * 1024L
    }
}
