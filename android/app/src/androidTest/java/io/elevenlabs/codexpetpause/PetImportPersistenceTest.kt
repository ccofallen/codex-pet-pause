package io.elevenlabs.codexpetpause

import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.bridge.AndroidStateStore
import io.elevenlabs.codexpetpause.petdex.PendingPetArchiveStore
import io.elevenlabs.codexpetpause.petdex.InvalidPetArchive
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import java.io.ByteArrayInputStream
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PetImportPersistenceTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
        DeviceQa.setOverlayPermission(true)
        DeviceQa.seedState()
    }

    @After
    fun tearDown() {
        DeviceQa.stopService()
    }

    @Test
    fun validNestedArchivePreviewsUsesAndReconstructsAfterActivityRelaunch() {
        val fixture = DeviceQa.testAsset("task9-valid-pet.zip")
        val atlasFixture = DeviceQa.testAsset("task9-valid-pet.webp")
        val decodedFixture = requireNotNull(
            BitmapFactory.decodeByteArray(atlasFixture, 0, atlasFixture.size),
        )
        assertEquals(1536, decodedFixture.width)
        assertEquals(2288, decodedFixture.height)

        val store = PendingPetArchiveStore(DeviceQa.context.cacheDir)
        val pending = store.accept(
            ByteArrayInputStream(fixture),
            "application/zip",
            "task9-valid-pet.zip",
        )

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            DeviceQa.awaitText("Pet security preview", "宠物安全预览")
            DeviceQa.clickText("Save and use this pet", "保存并使用这个宠物")
            DeviceQa.awaitCondition("imported pet selected") {
                selectedPetId() == "task9-momo"
            }
            DeviceQa.awaitCondition("pending archive acknowledged") {
                store.pendingTokens().isEmpty() && store.isCompleted(pending.token)
            }

            scenario.recreate()
            DeviceQa.awaitText("Phone navigation", "手机导航")
            DeviceQa.clickText("Pet", "宠物")
            DeviceQa.awaitText("Task 9 Momo")

            val builtinStartedAt = SystemClock.elapsedRealtime()
            DeviceQa.clickWebButton(scenario, "Use Momo", "使用 Momo")
            DeviceQa.awaitCondition("built-in pet selected without a stale imported overlay") {
                selectedPetId() == "builtin-cat" && activeOverlayPetId() == null
            }
            assertTrue(SystemClock.elapsedRealtime() - builtinStartedAt < 6_000L)

            val importedStartedAt = SystemClock.elapsedRealtime()
            DeviceQa.clickWebButton(scenario, "Use Task 9 Momo", "使用 Task 9 Momo")
            DeviceQa.awaitCondition("imported pet reselected without an app freeze") {
                selectedPetId() == "task9-momo" && activeOverlayPetId() == "task9-momo"
            }
            assertTrue(SystemClock.elapsedRealtime() - importedStartedAt < 6_000L)
        }

        val reconstructed = AndroidStateCoordinator(
            AndroidStateStore(DeviceQa.context.filesDir),
        )
        val snapshot = JSONObject(requireNotNull(reconstructed.loadSnapshot()))
        val selected = JSONObject(snapshot.getString("settingsJson")).getString("activePetId")
        val pet = snapshot.getJSONArray("pets").let { pets ->
            (0 until pets.length())
                .map(pets::getJSONObject)
                .single { it.getString("id") == selected }
        }
        val asset = DeviceQa.context.filesDir.resolve(pet.getString("assetPath")).readBytes()
        val decodedPersisted = requireNotNull(BitmapFactory.decodeByteArray(asset, 0, asset.size))

        assertEquals("task9-momo", selected)
        assertEquals(1536, decodedPersisted.width)
        assertEquals(2288, decodedPersisted.height)
        assertArrayEquals(atlasFixture, asset)

        DeviceQa.startService(PetOverlayService.START)
        val overlay = DeviceQa.awaitOverlay()
        assertEquals(DeviceQa.dp(72), overlay.width())
        assertEquals(DeviceQa.dp(72), overlay.height())
        assertEquals("task9-momo", selectedPetId())
        DeviceQa.assertOverlayDrawsVisiblePixels()
    }

    @Test
    fun pendingStoreRejectsNonArchiveMimeAndUnsafeDisplayName() {
        val fixture = DeviceQa.testAsset("task9-valid-pet.zip")
        val store = PendingPetArchiveStore(DeviceQa.context.cacheDir)

        assertThrows(InvalidPetArchive::class.java) {
            store.accept(ByteArrayInputStream(fixture), "text/plain", "task9-valid-pet.zip")
        }
        assertThrows(InvalidPetArchive::class.java) {
            store.accept(ByteArrayInputStream(fixture), "application/zip", "../escape.zip")
        }
        assertTrue(store.pendingTokens().isEmpty())
    }

    private fun selectedPetId(): String? {
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val snapshot = JSONObject(requireNotNull(coordinator.loadSnapshot()))
        return JSONObject(snapshot.getString("settingsJson")).optString("activePetId")
    }

    private fun activeOverlayPetId(): String? {
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val snapshot = JSONObject(requireNotNull(coordinator.loadSnapshot()))
        return snapshot.getJSONObject("overlay").optJSONObject("activePet")?.optString("id")
    }

}
