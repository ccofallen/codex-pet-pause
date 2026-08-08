package io.elevenlabs.codexpetpause.petdex

import java.io.ByteArrayInputStream
import java.io.File
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
    fun pendingQueueClaimsAndFinishesArchivesOneAtATimeInFifoOrder() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)
        val first = store.accept(ByteArrayInputStream(validZip(8)), "application/zip", "one.zip")
        val second = store.accept(ByteArrayInputStream(validZip(8)), "application/zip", "two.zip")
        val queue = PendingPetImportQueue(store)

        assertEquals(first.token, queue.nextAnnouncement())
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
}
