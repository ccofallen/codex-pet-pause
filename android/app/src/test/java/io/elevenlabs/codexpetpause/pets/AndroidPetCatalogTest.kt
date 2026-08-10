package io.elevenlabs.codexpetpause.pets

import java.io.Reader
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidPetCatalogTest {
    @Test
    fun serializesMetadataAndBoundedPreviewsWithoutFullSpritesheets() {
        val thumbnails = RecordingThumbnailStore()
        val catalog = AndroidPetCatalog(thumbnails)

        val result = JSONObject(catalog.load(snapshot()))

        assertEquals(9L, result.getLong("revision"))
        assertEquals("momo", result.getString("activePetId"))
        assertEquals(2, result.getJSONArray("pets").length())
        val first = result.getJSONArray("pets").getJSONObject(0)
        assertEquals(setOf("id", "metadataJson", "assetRevision", "thumbnailBase64"), first.keys().asSequence().toSet())
        assertEquals(FIRST_REVISION, first.getString("assetRevision"))
        assertEquals("dGlueQ==", first.getString("thumbnailBase64"))
        assertFalse(result.toString().contains("spritesheetBase64"))
        assertFalse(result.toString().contains(FULL_ATLAS_BASE64))
        assertEquals(setOf(assetPath("momo", FIRST_REVISION), assetPath("luna", SECOND_REVISION)), thumbnails.retained)
    }

    @Test
    fun isolatesAThumbnailFailureToItsCatalogEntry() {
        val thumbnails = RecordingThumbnailStore(failingPath = assetPath("luna", SECOND_REVISION))

        val pets = JSONObject(AndroidPetCatalog(thumbnails).load(snapshot())).getJSONArray("pets")

        assertEquals("dGlueQ==", pets.getJSONObject(0).getString("thumbnailBase64"))
        assertTrue(pets.getJSONObject(1).isNull("thumbnailBase64"))
    }

    @Test
    fun neverDecodesTheLegacyFullSpritesheetWhileProjectingTheCatalog() {
        val persisted = JSONObject(snapshot())
        persisted.getJSONArray("pets").getJSONObject(0).put("spritesheetBase64", "not-base64")

        val result = AndroidPetCatalog(RecordingThumbnailStore()).load(persisted.toString())

        assertFalse(result.contains("not-base64"))
        assertEquals(2, JSONObject(result).getJSONArray("pets").length())
    }

    @Test
    fun streamsAndSkipsLargeLegacySpritesheetsWithoutRequestingTheWholeValue() {
        val large = "A".repeat(3 * 1024 * 1024)
        val source = TrackingReader(snapshot().replace(FULL_ATLAS_BASE64, large), 257)

        val result = AndroidPetCatalog(RecordingThumbnailStore()).load(source)

        assertFalse(result.contains(large))
        assertTrue(source.maximumRequested <= 1024)
    }

    @Test
    fun isolatesRecoverablePreviewFailuresButPropagatesFatalVmErrors() {
        val fatal = OutOfMemoryError("atlas allocation failed")
        val thumbnails = object : PetThumbnailCatalogStore {
            override fun thumbnailBase64(assetPath: String): String = throw fatal
            override fun retain(assetPaths: Set<String>) = Unit
        }

        assertEquals(fatal, assertThrows(OutOfMemoryError::class.java) {
            AndroidPetCatalog(thumbnails).load(snapshot())
        })
    }

    private class TrackingReader(
        private val value: String,
        private val chunkSize: Int,
    ) : Reader() {
        private var offset = 0
        var maximumRequested = 0

        override fun read(buffer: CharArray, targetOffset: Int, length: Int): Int {
            maximumRequested = maxOf(maximumRequested, length)
            if (offset == value.length) return -1
            val count = minOf(length, chunkSize, value.length - offset)
            value.toCharArray(buffer, targetOffset, offset, offset + count)
            offset += count
            return count
        }

        override fun close() = Unit
    }

    private class RecordingThumbnailStore(
        private val failingPath: String? = null,
    ) : PetThumbnailCatalogStore {
        var retained: Set<String> = emptySet()

        override fun thumbnailBase64(assetPath: String): String {
            if (assetPath == failingPath) throw IllegalArgumentException("corrupt atlas")
            return "dGlueQ=="
        }

        override fun retain(assetPaths: Set<String>) {
            retained = assetPaths
        }
    }

    companion object {
        private const val FIRST_REVISION = "00000000000000000000000000000001"
        private const val SECOND_REVISION = "00000000000000000000000000000002"
        private const val FULL_ATLAS_BASE64 = "ZnVsbC1zcHJpdGVzaGVldC1ieXRlcw=="

        private fun metadata(id: String) =
            """{"id":"$id","displayName":"$id","spriteVersion":2,"spritesheetFilename":"$id.webp","importedAt":10,"updatedAt":20}"""

        private fun assetPath(id: String, revision: String) = "pets/$id/$revision/spritesheet.webp"

        private fun pet(id: String, revision: String) = JSONObject()
            .put("id", id)
            .put("metadataJson", metadata(id))
            .put("assetPath", assetPath(id, revision))
            .put("spritesheetBase64", FULL_ATLAS_BASE64)

        private fun snapshot(): String {
            val momo = pet("momo", FIRST_REVISION)
            return JSONObject()
                .put("schemaVersion", 1)
                .put("runtimeRevision", 9L)
                .put("settingsJson", JSONObject.NULL)
                .put("historyJson", JSONArray())
                .put("pets", JSONArray().put(momo).put(pet("luna", SECOND_REVISION)))
                .put("overlay", JSONObject().put("xRatio", 0.5).put("yRatio", 0.5).put("activePet", momo))
                .toString()
        }
    }
}
