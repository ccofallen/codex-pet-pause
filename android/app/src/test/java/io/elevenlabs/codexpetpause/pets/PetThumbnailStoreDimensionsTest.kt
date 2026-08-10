package io.elevenlabs.codexpetpause.pets

import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PetThumbnailStoreDimensionsTest {
    @Test
    fun regeneratesADecodableCachedPngWiderThan128Pixels() {
        val filesDir = Files.createTempDirectory("pet-thumbnail-dimensions").toFile()
        try {
            val revision = "a".repeat(32)
            val assetPath = "pets/pet-1/$revision/spritesheet.webp"
            val atlas = File(filesDir, assetPath)
            atlas.parentFile?.mkdirs()
            atlas.writeBytes(byteArrayOf(1))

            val generated = png(width = 128, height = 128)
            var generationCount = 0
            val store = PetThumbnailStore(filesDir, PetThumbnailGenerator {
                generationCount += 1
                generated
            })

            store.thumbnailBase64(assetPath)
            val cacheFile = File(filesDir, "pet-thumbnails").listFiles()!!.single()
            cacheFile.writeBytes(png(width = 129, height = 128))

            val regenerated = Base64.getDecoder().decode(store.thumbnailBase64(assetPath))

            assertEquals(2, generationCount)
            assertArrayEquals(generated, regenerated)
            assertArrayEquals(generated, cacheFile.readBytes())
        } finally {
            filesDir.deleteRecursively()
        }
    }

    private fun png(width: Int, height: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        return try {
            check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            output.toByteArray()
        } finally {
            bitmap.recycle()
        }
    }
}
