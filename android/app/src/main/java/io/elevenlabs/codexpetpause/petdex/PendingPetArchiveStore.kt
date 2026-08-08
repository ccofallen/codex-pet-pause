package io.elevenlabs.codexpetpause.petdex

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.Locale
import java.util.UUID

internal class ArchiveTooLarge : IOException("Pet archive exceeds the maximum size")
internal class InvalidPetArchive : IOException("Pet archive is not a supported ZIP")
internal class PendingArchiveMissing : IOException("Pending pet archive was not found")
internal class PendingArchiveQuotaExceeded : IOException("Pending pet archive quota is full")

internal data class PendingPetArchive(val token: String, val name: String)
internal data class PendingPetArchiveData(val name: String, val bytes: ByteArray)

internal class PendingPetArchiveStore(
    rootDirectory: File,
    private val maxArchiveBytes: Long = DEFAULT_MAX_ARCHIVE_BYTES,
    private val maxAggregateBytes: Long = DEFAULT_MAX_AGGREGATE_BYTES,
    private val maxPendingArchives: Int = DEFAULT_MAX_PENDING_ARCHIVES,
    private val archiveTtlMillis: Long = DEFAULT_ARCHIVE_TTL_MILLIS,
    private val clockMillis: () -> Long = System::currentTimeMillis,
    private val deleteFile: (File) -> Boolean = { it.delete() },
) {
    private val directory = File(rootDirectory, "pending-pet-archives")
    private val safeToken = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
    private var lastPublishedAt = 0L

    init {
        require(maxArchiveBytes > 0 && maxAggregateBytes > 0)
        require(maxPendingArchives > 0 && archiveTtlMillis > 0)
        synchronized(STORE_LOCK) { cleanupLocked() }
    }

    fun accept(input: InputStream, mimeType: String, suggestedName: String): PendingPetArchive =
        synchronized(STORE_LOCK) {
            requireArchiveMime(mimeType)
            if (!isSafeArchiveName(suggestedName)) throw InvalidPetArchive()
            ensureDirectory()
            cleanupLocked()
            val pending = pendingFilesLocked()
            if (pending.size >= maxPendingArchives) throw PendingArchiveQuotaExceeded()
            val committedBytes = directory.listFiles()
                ?.filter(File::isFile)
                ?.sumOf(File::length)
                ?: 0L
            if (committedBytes >= maxAggregateBytes) throw PendingArchiveQuotaExceeded()

            val token = UUID.randomUUID().toString()
            val temporary = File(directory, ".$token.tmp")
            val target = archiveFile(token)
            val publishedAt = nextPublicationTimeLocked()
            try {
                val header = ByteArray(4)
                var headerBytes = 0
                var total = 0L
                temporary.outputStream().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (count == 0) continue
                        if (total + count > maxArchiveBytes) throw ArchiveTooLarge()
                        if (committedBytes + total + count > maxAggregateBytes) {
                            throw PendingArchiveQuotaExceeded()
                        }
                        if (headerBytes < header.size) {
                            val copied = minOf(count, header.size - headerBytes)
                            buffer.copyInto(header, headerBytes, 0, copied)
                            headerBytes += copied
                        }
                        output.write(buffer, 0, count)
                        total += count
                    }
                }
                if (total == 0L || headerBytes < header.size || !isZipHeader(header)) {
                    throw InvalidPetArchive()
                }
                if (target.exists() || !temporary.renameTo(target)) {
                    throw IOException("Could not publish pending pet archive")
                }
                if (!target.setLastModified(publishedAt)) {
                    target.delete()
                    throw IOException("Could not timestamp pending pet archive")
                }
                lastPublishedAt = publishedAt
                PendingPetArchive(token, archiveName(token))
            } catch (error: Throwable) {
                temporary.delete()
                target.delete()
                throw error
            }
        }

    fun peek(token: String): PendingPetArchiveData = synchronized(STORE_LOCK) {
        requireSafeToken(token)
        cleanupLocked()
        val file = archiveFile(token)
        if (!file.isFile) throw PendingArchiveMissing()
        val bytes = file.inputStream().use(::readBounded)
        if (!isZipHeader(bytes)) throw InvalidPetArchive()
        PendingPetArchiveData(archiveName(token), bytes)
    }

    fun acknowledge(token: String) = synchronized(STORE_LOCK) {
        requireSafeToken(token)
        val file = archiveFile(token)
        if (!file.isFile) throw PendingArchiveMissing()
        val tombstone = File(directory, ".$token.ack")
        if (!file.renameTo(tombstone)) throw IOException("Could not release acknowledged pet archive")
        deleteFile(tombstone)
    }

    fun pendingTokens(): List<String> = synchronized(STORE_LOCK) {
        cleanupLocked()
        pendingFilesLocked()
            .sortedWith(compareBy(File::lastModified, File::getName))
            .map { it.name.removeSuffix(".zip") }
    }

    internal fun pendingFiles(): List<File> = synchronized(STORE_LOCK) {
        cleanupLocked()
        pendingFilesLocked().toList()
    }

    private fun ensureDirectory() {
        if (!directory.exists() && !directory.mkdirs()) {
            throw IOException("Could not create archive handoff directory")
        }
    }

    private fun cleanupLocked() {
        if (!directory.exists()) return
        val cutoff = clockMillis() - archiveTtlMillis
        directory.listFiles().orEmpty().forEach { file ->
            val token = file.name.removeSuffix(".zip")
            if (!file.isFile
                || file.name.endsWith(".tmp")
                || file.name.endsWith(".ack")
                || !file.name.endsWith(".zip")
                || !safeToken.matches(token)
                || file.lastModified() <= cutoff) {
                deleteFile(file)
            }
        }
    }

    private fun pendingFilesLocked(): List<File> = directory.listFiles()
        ?.filter {
            it.isFile && it.name.endsWith(".zip")
                && safeToken.matches(it.name.removeSuffix(".zip"))
        }
        .orEmpty()

    private fun nextPublicationTimeLocked(): Long {
        val latestFile = pendingFilesLocked().maxOfOrNull(File::lastModified) ?: 0L
        return maxOf(clockMillis(), lastPublishedAt + 1, latestFile + 1)
    }

    private fun readBounded(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            if (total + count > maxArchiveBytes) throw ArchiveTooLarge()
            output.write(buffer, 0, count)
            total += count
        }
        return output.toByteArray()
    }

    private fun requireArchiveMime(value: String) {
        val mime = value.substringBefore(';').trim().lowercase(Locale.ROOT)
        if (mime !in ARCHIVE_MIME_TYPES) throw InvalidPetArchive()
    }

    private fun requireSafeToken(token: String) {
        require(safeToken.matches(token)) { "Unsafe pending archive token" }
    }

    private fun isSafeArchiveName(value: String): Boolean = value.length in 1..255
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains('\u0000')
        && value.lowercase(Locale.ROOT).endsWith(".zip")

    private fun archiveFile(token: String) = File(directory, "$token.zip")
    private fun archiveName(token: String) = "pet-$token.zip"

    companion object {
        internal const val DEFAULT_MAX_ARCHIVE_BYTES = 32L * 1024L * 1024L
        internal const val DEFAULT_MAX_AGGREGATE_BYTES = 64L * 1024L * 1024L
        internal const val DEFAULT_MAX_PENDING_ARCHIVES = 4
        internal const val DEFAULT_ARCHIVE_TTL_MILLIS = 24L * 60L * 60L * 1_000L
        private val STORE_LOCK = Any()
        private val ARCHIVE_MIME_TYPES = setOf(
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream",
        )

        private fun isZipHeader(bytes: ByteArray): Boolean = bytes.size >= 4
            && bytes[0] == 'P'.code.toByte()
            && bytes[1] == 'K'.code.toByte()
            && ((bytes[2] == 3.toByte() && bytes[3] == 4.toByte())
                || (bytes[2] == 5.toByte() && bytes[3] == 6.toByte())
                || (bytes[2] == 7.toByte() && bytes[3] == 8.toByte()))
    }
}
