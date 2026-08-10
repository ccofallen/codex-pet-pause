package io.elevenlabs.codexpetpause.pets

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PetThumbnailStoreTest {
    private val root = Files.createTempDirectory("pet-thumbnails").toFile()

    @After
    fun cleanUp() {
        root.deleteRecursively()
    }

    @Test
    fun cropsTheFirstIdleCellAndBoundsTheEncodedThumbnail() {
        val path = assetPath("momo", FIRST_REVISION)
        writeAtlas(path, 1536, 2288)

        val encoded = PetThumbnailStore(root).thumbnailBase64(path)
        val thumbnail = BitmapFactory.decodeByteArray(
            Base64.getDecoder().decode(encoded),
            0,
            Base64.getDecoder().decode(encoded).size,
        )

        assertTrue(thumbnail.width <= 128)
        assertTrue(thumbnail.height <= 128)
        assertEquals(118, thumbnail.width)
        assertEquals(128, thumbnail.height)
        thumbnail.recycle()
    }

    @Test
    fun reusesTheCachedThumbnailForAnImmutableAssetRevision() {
        val path = assetPath("momo", FIRST_REVISION)
        writeAtlas(path, 1536, 2288)
        val store = PetThumbnailStore(root)
        val first = store.thumbnailBase64(path)
        File(root, path).delete()

        assertEquals(first, store.thumbnailBase64(path))
    }

    @Test
    fun serializesGenerationAndCleansCacheEntriesForUnreferencedAssets() {
        val active = AtomicInteger()
        val maximum = AtomicInteger()
        val release = CountDownLatch(1)
        val generator = PetThumbnailGenerator {
            val current = active.incrementAndGet()
            maximum.accumulateAndGet(current, ::maxOf)
            release.await(2, TimeUnit.SECONDS)
            active.decrementAndGet()
            validThumbnailBytes()
        }
        val firstPath = assetPath("momo", FIRST_REVISION)
        val secondPath = assetPath("luna", SECOND_REVISION)
        listOf(firstPath, secondPath).forEach { path ->
            File(root, path).apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1)) }
        }
        val store = PetThumbnailStore(root, generator)
        val executor = Executors.newFixedThreadPool(2)
        val futures = listOf(firstPath, secondPath).map { path ->
            executor.submit<String> { store.thumbnailBase64(path) }
        }

        Thread.sleep(40)
        release.countDown()
        futures.forEach { it.get(2, TimeUnit.SECONDS) }
        executor.shutdownNow()
        assertEquals(1, maximum.get())
        assertEquals(2, thumbnailFiles().size)

        store.retain(setOf(firstPath))

        assertEquals(1, thumbnailFiles().size)
    }

    @Test
    fun recoversAnInterruptedAtomicWriteAndRejectsMalformedCachedPngBytes() {
        val path = assetPath("momo", FIRST_REVISION)
        writeAtlas(path, 1536, 2288)
        val store = PetThumbnailStore(root)
        val expected = store.thumbnailBase64(path)
        val target = thumbnailFiles().single()
        val backup = File("${target.path}.bak")
        target.copyTo(backup)
        target.writeBytes(byteArrayOf(1, 2, 3))
        File(root, path).delete()

        assertEquals(expected, store.thumbnailBase64(path))
        assertTrue(BitmapFactory.decodeFile(target.path).width <= 128)

        writeAtlas(path, 1536, 2288)
        target.writeBytes(byteArrayOf(9, 8, 7))
        assertTrue(BitmapFactory.decodeByteArray(
            Base64.getDecoder().decode(store.thumbnailBase64(path)), 0,
            Base64.getDecoder().decode(store.thumbnailBase64(path)).size,
        ).width <= 128)
    }

    @Test
    fun regeneratesAHeaderValidPngWhosePixelDataIsTruncated() {
        val path = assetPath("momo", FIRST_REVISION)
        writeAtlas(path, 1536, 2288)
        val store = PetThumbnailStore(root)
        val expected = store.thumbnailBase64(path)
        val target = thumbnailFiles().single()
        val valid = target.readBytes()
        target.writeBytes(valid.copyOf(33))

        val recovered = store.thumbnailBase64(path)

        assertEquals(expected, recovered)
        assertTrue(target.length() > 33)
    }

    @Test
    fun retainWaitsForGenerationAndPreservesAtomicRecoverySiblingsForLiveAssets() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val path = assetPath("momo", FIRST_REVISION)
        File(root, path).apply { parentFile!!.mkdirs(); writeBytes(byteArrayOf(1)) }
        val store = PetThumbnailStore(root, PetThumbnailGenerator {
            entered.countDown()
            release.await(2, TimeUnit.SECONDS)
            validThumbnailBytes()
        })
        val executor = Executors.newFixedThreadPool(2)
        val generation = executor.submit<String> { store.thumbnailBase64(path) }
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        val retention = executor.submit { store.retain(setOf(path)) }
        release.countDown()
        generation.get(2, TimeUnit.SECONDS)
        retention.get(2, TimeUnit.SECONDS)
        val target = thumbnailFiles().single()
        val backup = File("${target.path}.bak").apply { writeBytes(target.readBytes()) }

        store.retain(setOf(path))

        assertTrue(target.exists())
        assertTrue(backup.exists())
        executor.shutdownNow()
    }

    private fun writeAtlas(path: String, width: Int, height: Int) {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.rgb(30, 120, 180))
        File(root, path).apply {
            parentFile!!.mkdirs()
            outputStream().use { output ->
                assertTrue(bitmap.compress(Bitmap.CompressFormat.WEBP_LOSSLESS, 100, output))
            }
        }
        bitmap.recycle()
    }

    private fun thumbnailFiles(): List<File> =
        File(root, "pet-thumbnails").listFiles()?.filter { !it.name.endsWith(".bak") && !it.name.endsWith(".new") }.orEmpty()

    private fun validThumbnailBytes(): ByteArray {
        val bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.RED)
        return java.io.ByteArrayOutputStream().use { output ->
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
            bitmap.recycle()
            output.toByteArray()
        }
    }

    private fun assetPath(id: String, revision: String) = "pets/$id/$revision/spritesheet.webp"

    companion object {
        private const val FIRST_REVISION = "00000000000000000000000000000001"
        private const val SECOND_REVISION = "00000000000000000000000000000002"
    }
}
