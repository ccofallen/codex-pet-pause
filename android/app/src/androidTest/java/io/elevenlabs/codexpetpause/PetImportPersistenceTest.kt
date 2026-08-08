package io.elevenlabs.codexpetpause

import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.petdex.InvalidPetArchive
import io.elevenlabs.codexpetpause.petdex.PendingArchiveOutcome
import io.elevenlabs.codexpetpause.petdex.PendingPetArchiveStore
import io.elevenlabs.codexpetpause.petdex.PendingPetImportQueue
import io.elevenlabs.codexpetpause.petdex.PetdexSecurityPolicy
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PetImportPersistenceTest {
    @Before fun setUp() { DeviceQa.reset(); DeviceQa.seedState() }
    @After fun tearDown() = DeviceQa.stopService()

    @Test
    fun nestedArchiveQueuesImmediatelyAndSurvivesActivityRestartUntilAcknowledged() {
        val bytes = nestedPetArchive()
        val store = PendingPetArchiveStore(DeviceQa.context.cacheDir)
        val pending = store.accept(ByteArrayInputStream(bytes), "application/zip", "momo.zip")
        val queue = PendingPetImportQueue(store)
        assertEquals(pending.token, queue.nextAnnouncement())
        assertArrayEquals(bytes, queue.claim(pending.token).bytes)

        ActivityScenario.launch(MainActivity::class.java).use { DeviceQa.awaitText("Phone status", "手机状态") }
        val restoredStore = PendingPetArchiveStore(DeviceQa.context.cacheDir)
        assertEquals(listOf(pending.token), restoredStore.pendingTokens())
        assertArrayEquals(bytes, restoredStore.peek(pending.token).bytes)
        val restoredQueue = PendingPetImportQueue(restoredStore)
        assertEquals(pending.token, restoredQueue.nextAnnouncement())
        restoredQueue.claim(pending.token)
        assertEquals(null, restoredQueue.finish(pending.token, PendingArchiveOutcome.IMPORTED))
        assertTrue(restoredStore.pendingTokens().isEmpty())
    }

    @Test
    fun validatedPetAndSelectionPersistAcrossActivityAndCoordinatorRestart() {
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val atlas = "device-atlas".toByteArray()
        val metadata = JSONObject().put("id", "device-momo").put("displayName", "Device Momo")
            .put("spriteVersion", 2).put("spritesheetFilename", "spritesheet.webp")
            .put("importedAt", 10).put("updatedAt", 20).toString()
        coordinator.persistValidatedPet("device-momo", metadata, Base64.encodeToString(atlas, Base64.NO_WRAP))
        ActivityScenario.launch(MainActivity::class.java).use { DeviceQa.awaitText("Phone status", "手机状态") }

        val snapshot = JSONObject(requireNotNull(
            AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir).loadSnapshot(),
        ))
        val pet = snapshot.getJSONArray("pets").getJSONObject(0)
        assertEquals("device-momo", pet.getString("id"))
        assertEquals("device-momo", JSONObject(snapshot.getString("settingsJson")).getString("activePetId"))
        assertArrayEquals(atlas, DeviceQa.context.filesDir.resolve(pet.getString("assetPath")).readBytes())
    }

    @Test
    fun importBoundaryRejectsInvalidZipUnsafeTokenAndNonPetdexOrigins() {
        val store = PendingPetArchiveStore(DeviceQa.context.cacheDir)
        assertThrows(InvalidPetArchive::class.java) {
            store.accept(ByteArrayInputStream("not a zip".toByteArray()), "application/zip", "bad.zip")
        }
        assertThrows(IllegalArgumentException::class.java) { store.peek("../escape") }
        assertTrue(store.pendingTokens().isEmpty())
        assertTrue(PetdexSecurityPolicy.isAllowedPage("https://petdex.dev/pets/momo"))
        assertTrue(PetdexSecurityPolicy.isAllowedDownload(
            "https://petdex.dev/download/momo.zip", "application/zip", "momo.zip",
        ))
        assertFalse(PetdexSecurityPolicy.isAllowedPage("http://127.0.0.1:8080/momo"))
        assertFalse(PetdexSecurityPolicy.isAllowedDownload(
            "https://petdex.dev.evil.invalid/momo.zip", "application/zip", "momo.zip",
        ))
    }

    private fun nestedPetArchive() = ByteArrayOutputStream().use { output ->
        ZipOutputStream(output).use { zip ->
            zip.putNextEntry(ZipEntry("momo/pet.json"))
            zip.write("""{"id":"momo","displayName":"Momo"}""".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("momo/spritesheet.webp"))
            zip.write("webp".toByteArray())
            zip.closeEntry()
        }
        output.toByteArray()
    }
}
