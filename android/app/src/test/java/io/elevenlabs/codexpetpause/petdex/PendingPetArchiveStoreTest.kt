package io.elevenlabs.codexpetpause.petdex

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PendingPetArchiveStoreTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun oversizedDownloadIsDeletedBeforeWebViewHandoff() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 8)

        assertThrows(ArchiveTooLarge::class.java) {
            store.accept(ByteArrayInputStream(validZip(9)), "application/zip", "momo.zip")
        }

        assertTrue(store.pendingFiles().isEmpty())
    }

    @Test
    fun claimedArchiveSurvivesReadAndRestartUntilExplicitAcknowledgement() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)
        val bytes = validZip(12)
        val pending = store.accept(ByteArrayInputStream(bytes), "application/zip", "momo.zip")

        assertEquals(listOf(pending.token), store.pendingTokens())
        assertArrayEquals(bytes, store.peek(pending.token).bytes)
        assertFalse(store.pendingFiles().isEmpty())

        val restored = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)
        assertEquals(listOf(pending.token), restored.pendingTokens())
        assertArrayEquals(bytes, restored.peek(pending.token).bytes)
        restored.acknowledge(pending.token)
        assertTrue(store.pendingFiles().isEmpty())
        assertThrows(PendingArchiveMissing::class.java) { restored.peek(pending.token) }
    }

    @Test
    fun invalidZipContentAndUnsafeTokensNeverEscapeThePrivateDirectory() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)

        assertThrows(InvalidPetArchive::class.java) {
            store.accept(ByteArrayInputStream("not-a-zip".toByteArray()), "application/zip", "momo.zip")
        }
        assertThrows(IllegalArgumentException::class.java) { store.peek("../escape") }
        assertTrue(store.pendingFiles().isEmpty())
    }

    @Test
    fun startupCleanupRemovesExpiredArchivesAndEveryOrphanTemporaryFile() {
        val directory = File(temporary.root, "pending-pet-archives").apply { mkdirs() }
        File(directory, "expired-token.zip").apply {
            writeBytes(validZip(8))
            setLastModified(100)
        }
        File(directory, "fresh-token.zip").apply {
            writeBytes(validZip(8))
            setLastModified(900)
        }
        File(directory, ".interrupted.tmp").writeBytes(validZip(8))

        val store = PendingPetArchiveStore(
            temporary.root,
            maxArchiveBytes = 32,
            archiveTtlMillis = 500,
            clockMillis = { 1_000 },
        )

        assertEquals(listOf("fresh-token"), store.pendingTokens())
        assertFalse(File(directory, "expired-token.zip").exists())
        assertFalse(File(directory, ".interrupted.tmp").exists())
    }

    @Test
    fun aggregateQuotaAndPendingCountPreventUnboundedPrevalidationFiles() {
        val aggregate = PendingPetArchiveStore(
            temporary.root,
            maxArchiveBytes = 32,
            maxAggregateBytes = 12,
            maxPendingArchives = 4,
        )
        aggregate.accept(ByteArrayInputStream(validZip(8)), "application/zip", "one.zip")

        assertThrows(PendingArchiveQuotaExceeded::class.java) {
            aggregate.accept(ByteArrayInputStream(validZip(8)), "application/zip", "two.zip")
        }
        assertEquals(1, aggregate.pendingFiles().size)

        val countRoot = temporary.newFolder("count")
        val countBounded = PendingPetArchiveStore(
            countRoot,
            maxArchiveBytes = 32,
            maxAggregateBytes = 64,
            maxPendingArchives = 1,
        )
        countBounded.accept(ByteArrayInputStream(validZip(8)), "application/zip", "one.zip")
        assertThrows(PendingArchiveQuotaExceeded::class.java) {
            countBounded.accept(ByteArrayInputStream(validZip(8)), "application/zip", "two.zip")
        }
        assertEquals(1, countBounded.pendingFiles().size)
    }

    @Test
    fun aggregateQuotaIsAtomicAcrossConcurrentStoreInstances() {
        val first = PendingPetArchiveStore(
            temporary.root,
            maxArchiveBytes = 32,
            maxAggregateBytes = 12,
            maxPendingArchives = 4,
        )
        val second = PendingPetArchiveStore(
            temporary.root,
            maxArchiveBytes = 32,
            maxAggregateBytes = 12,
            maxPendingArchives = 4,
        )
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(2)
        try {
            val futures = listOf(first, second).mapIndexed { index, store ->
                executor.submit<Boolean> {
                    start.await()
                    runCatching {
                        store.accept(
                            ByteArrayInputStream(validZip(8)),
                            "application/zip",
                            "concurrent-$index.zip",
                        )
                    }.isSuccess
                }
            }
            start.countDown()

            assertEquals(1, futures.count { it.get(5, TimeUnit.SECONDS) })
            assertEquals(1, first.pendingFiles().size)
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun resumedProcessCleanupCannotDeleteAnotherProcessesActiveArchivePublication() {
        val ready = File(temporary.root, "writer-ready")
        val release = File(temporary.root, "release-writer")
        val writer = ProcessBuilder(
            File(System.getProperty("java.home"), "bin/java").absolutePath,
            "-cp",
            System.getProperty("java.class.path"),
            PendingPetArchiveStorePublicationProbe::class.java.name,
            temporary.root.absolutePath,
            ready.absolutePath,
            release.absolutePath,
        ).redirectErrorStream(true).start()
        val executor = Executors.newSingleThreadExecutor()
        try {
            waitForFile(ready)
            val readerFinished = CountDownLatch(1)
            val resumedStore = executor.submit<PendingPetArchiveStore> {
                PendingPetArchiveStore(temporary.root).also { readerFinished.countDown() }
            }

            assertFalse(
                "main-process cleanup must wait while another process publishes its temporary archive",
                readerFinished.await(200, TimeUnit.MILLISECONDS),
            )

            release.writeText("publish")
            assertTrue(writer.waitFor(5, TimeUnit.SECONDS))
            assertEquals(writer.inputStream.bufferedReader().readText(), 0, writer.exitValue())
            assertEquals(1, resumedStore.get(5, TimeUnit.SECONDS).pendingTokens().size)
        } finally {
            release.writeText("publish")
            writer.waitFor(5, TimeUnit.SECONDS)
            writer.destroyForcibly()
            executor.shutdownNow()
        }
    }

    @Test
    fun pendingQueueClaimsAndFinishesArchivesOneAtATimeInFifoOrder() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)
        val first = store.accept(ByteArrayInputStream(validZip(8)), "application/zip", "one.zip")
        val second = store.accept(ByteArrayInputStream(validZip(8)), "application/zip", "two.zip")
        val queue = PendingPetImportQueue(store)

        assertEquals(first.token, queue.nextAnnouncement())
        assertEquals(first.token, queue.currentAnnouncement())
        assertNull(queue.nextAnnouncement())
        assertArrayEquals(validZip(8), queue.claim(first.token).bytes)
        assertFalse(store.pendingFiles().isEmpty())
        assertNull(queue.nextAnnouncement())

        assertEquals(second.token, queue.finish(first.token, PendingArchiveOutcome.CANCELLED))
        assertThrows(PendingArchiveMissing::class.java) { store.peek(first.token) }
        assertArrayEquals(validZip(8), queue.claim(second.token).bytes)
        assertNull(queue.finish(second.token, PendingArchiveOutcome.RETRY))
        assertArrayEquals(validZip(8), store.peek(second.token).bytes)
    }

    @Test
    fun failedPhysicalDeletionIsTombstonedAndCannotBlockTheNextFifoClaim() {
        var deletionFails = true
        val store = PendingPetArchiveStore(
            temporary.root,
            maxArchiveBytes = 32,
            deleteFile = { file ->
                if (deletionFails && file.name.endsWith(".ack")) false else file.delete()
            },
        )
        val first = store.accept(ByteArrayInputStream(validZip(8)), "application/zip", "one.zip")
        val second = store.accept(ByteArrayInputStream(validZip(8)), "application/zip", "two.zip")
        val queue = PendingPetImportQueue(store)
        assertEquals(first.token, queue.nextAnnouncement())
        queue.claim(first.token)

        assertEquals(second.token, queue.finish(first.token, PendingArchiveOutcome.IMPORTED))
        assertEquals(listOf(second.token), store.pendingTokens())
        val directory = File(temporary.root, "pending-pet-archives")
        assertTrue(directory.listFiles().orEmpty().any { it.name.endsWith(".ack") })

        deletionFails = false
        store.pendingTokens()
        assertFalse(directory.listFiles().orEmpty().any { it.name.endsWith(".ack") })
    }

    @Test
    fun PetdexPolicyAllowsOnlyExactHttpsSiteAndZipDownloads() {
        assertTrue(PetdexSecurityPolicy.isAllowedPage("https://petdex.dev/"))
        assertTrue(PetdexSecurityPolicy.isAllowedPage("https://petdex.dev/pets/momo"))
        assertFalse(PetdexSecurityPolicy.isAllowedPage("http://petdex.dev/pets/momo"))
        assertFalse(PetdexSecurityPolicy.isAllowedPage("https://cdn.petdex.dev/momo.zip"))
        assertFalse(PetdexSecurityPolicy.isAllowedPage("https://petdex.dev.evil.example/momo.zip"))
        assertTrue(PetdexSecurityPolicy.isAllowedDownload(
            "https://petdex.dev/download/momo.zip",
            "application/zip",
            "momo.zip",
        ))
        assertFalse(PetdexSecurityPolicy.isAllowedDownload(
            "https://petdex.dev/download/momo.zip",
            "text/html",
            "momo.zip",
        ))
        assertFalse(PetdexSecurityPolicy.isAllowedDownload(
            "https://petdex.dev/download/momo.webp",
            "application/zip",
            "momo.webp",
        ))
    }

    private fun validZip(size: Int): ByteArray = ByteArray(size).also {
        it[0] = 'P'.code.toByte()
        it[1] = 'K'.code.toByte()
        it[2] = 3
        it[3] = 4
    }

    private fun waitForFile(file: File) {
        repeat(100) {
            if (file.isFile) return
            Thread.sleep(10)
        }
        throw AssertionError("Writer did not create ${file.name}")
    }
}

object PendingPetArchiveStorePublicationProbe {
    @JvmStatic
    fun main(args: Array<String>) {
        PendingPetArchiveStore(File(args[0]), maxArchiveBytes = 32).accept(
            PublicationBlockingZipInputStream(File(args[1]), File(args[2])),
            "application/zip",
            "process-boundary.zip",
        )
    }
}

private class PublicationBlockingZipInputStream(
    private val ready: File,
    private val release: File,
) : InputStream() {
    private val bytes = byteArrayOf('P'.code.toByte(), 'K'.code.toByte(), 3, 4, 0, 0, 0, 0)
    private var offset = 0
    private var signalled = false

    override fun read(): Int = ByteArray(1).let { buffer ->
        if (read(buffer) < 0) -1 else buffer[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, off: Int, len: Int): Int {
        if (!signalled) {
            ready.writeText("temporary archive is open")
            signalled = true
            while (!release.isFile) Thread.sleep(10)
        }
        if (offset == bytes.size) return -1
        val count = minOf(len, bytes.size - offset)
        bytes.copyInto(buffer, off, offset, offset + count)
        offset += count
        return count
    }
}
