package io.elevenlabs.codexpetpause.pets

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.AtomicFile
import io.elevenlabs.codexpetpause.bridge.AndroidStateValidator
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Base64
import kotlin.math.roundToInt

internal fun interface PetThumbnailGenerator {
    fun generate(source: File): ByteArray
}

internal interface PetThumbnailCatalogStore {
    fun thumbnailBase64(assetPath: String): String
    fun retain(assetPaths: Set<String>)
}

internal class PetThumbnailStore(
    private val filesDir: File,
    private val generator: PetThumbnailGenerator = AndroidPetThumbnailGenerator(),
) : PetThumbnailCatalogStore {
    private val cacheRoot = File(filesDir, "pet-thumbnails")

    @Synchronized
    override fun thumbnailBase64(assetPath: String): String {
        val directory = AndroidStateValidator.assetDirectory(filesDir, assetPath)
        val source = File(directory, "spritesheet.webp")
        val target = cacheFile(assetPath)
        val atomicFile = AtomicFile(target)
        val cached = try {
            atomicFile.openRead().use { it.readBytes() }
        } catch (_: Exception) {
            null
        }
        if (cached != null && isValidPng(cached)) return Base64.getEncoder().encodeToString(cached)
        atomicFile.delete()
        require(source.isFile && source.length() in 1..MAX_SPRITESHEET_BYTES) { "Invalid Android pet atlas" }

        val thumbnail = generator.generate(source)
        require(isValidPng(thumbnail)) { "Invalid Android pet thumbnail" }
        writeAtomically(target, thumbnail)
        return Base64.getEncoder().encodeToString(thumbnail)
    }

    @Synchronized
    override fun retain(assetPaths: Set<String>) {
        val retainedNames = assetPaths.mapNotNull { path ->
            try { cacheFile(path).name } catch (_: Exception) { null }
        }.flatMap { listOf(it, "$it.bak", "$it.new") }.toSet()
        cacheRoot.listFiles().orEmpty()
            .filter { it.name !in retainedNames }
            .forEach { try { it.deleteRecursively() } catch (_: Exception) { Unit } }
        if (cacheRoot.listFiles().isNullOrEmpty()) try { cacheRoot.delete() } catch (_: Exception) { Unit }
    }

    private fun cacheFile(assetPath: String): File {
        val directory = AndroidStateValidator.assetDirectory(filesDir, assetPath)
        val id = directory.parentFile?.name ?: throw IllegalArgumentException("Invalid Android pet asset path")
        return File(cacheRoot, "$id.${directory.name}.png")
    }

    private fun writeAtomically(target: File, bytes: ByteArray) {
        target.parentFile?.mkdirs()
        val atomicFile = AtomicFile(target)
        var stream: FileOutputStream? = null
        try {
            stream = atomicFile.startWrite()
            stream.write(bytes)
            atomicFile.finishWrite(stream)
            stream = null
        } catch (error: IOException) {
            if (stream != null) atomicFile.failWrite(stream)
            throw error
        }
    }

    private fun isValidPng(bytes: ByteArray): Boolean {
        if (bytes.size !in 1..MAX_THUMBNAIL_BYTES.toInt()
            || !bytes.take(PNG_SIGNATURE.size).toByteArray().contentEquals(PNG_SIGNATURE)) return false
        val bitmap = try {
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) {
            null
        } ?: return false
        return try {
            bitmap.width in 1..128 && bitmap.height in 1..128
        } finally {
            bitmap.recycle()
        }
    }

    companion object {
        private const val MAX_SPRITESHEET_BYTES = 16L * 1024L * 1024L
        private const val MAX_THUMBNAIL_BYTES = 256L * 1024L
        private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    }
}

private class AndroidPetThumbnailGenerator : PetThumbnailGenerator {
    override fun generate(source: File): ByteArray {
        val bounds = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        val rows = when {
            bounds.outWidth == ATLAS_WIDTH && bounds.outHeight == V1_ATLAS_HEIGHT -> 9
            bounds.outWidth == ATLAS_WIDTH && bounds.outHeight == V2_ATLAS_HEIGHT -> 11
            else -> throw IllegalArgumentException("Invalid Android pet atlas dimensions")
        }
        val atlas = BitmapFactory.decodeFile(source.path)
            ?: throw IllegalArgumentException("Invalid Android pet atlas")
        var frame: Bitmap? = null
        var thumbnail: Bitmap? = null
        try {
            require(atlas.width == bounds.outWidth && atlas.height == bounds.outHeight) {
                "Invalid Android pet atlas dimensions"
            }
            frame = Bitmap.createBitmap(atlas, 0, 0, atlas.width / 8, atlas.height / rows)
            val scale = minOf(MAX_DIMENSION.toDouble() / frame.width, MAX_DIMENSION.toDouble() / frame.height, 1.0)
            val width = (frame.width * scale).roundToInt().coerceAtLeast(1)
            val height = (frame.height * scale).roundToInt().coerceAtLeast(1)
            thumbnail = Bitmap.createScaledBitmap(frame, width, height, true)
            return ByteArrayOutputStream().use { output ->
                require(thumbnail.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                    "Could not encode Android pet thumbnail"
                }
                output.toByteArray()
            }
        } finally {
            if (thumbnail != null && thumbnail !== frame && thumbnail !== atlas) thumbnail.recycle()
            if (frame != null && frame !== atlas) frame.recycle()
            atlas.recycle()
        }
    }

    companion object {
        private const val ATLAS_WIDTH = 1536
        private const val V1_ATLAS_HEIGHT = 1872
        private const val V2_ATLAS_HEIGHT = 2288
        private const val MAX_DIMENSION = 128
    }
}
