package io.elevenlabs.codexpetpause.petdex

import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingPetImportQueueIdempotencyTest {
    private fun root(): File = Files.createTempDirectory("pending-pet-replay").toFile()

    private fun add(store: PendingPetArchiveStore): PendingPetArchive = store.accept(
        ByteArrayInputStream(byteArrayOf('P'.code.toByte(), 'K'.code.toByte(), 3, 4, 1)),
        "application/zip",
        "pet.zip",
    )

    @Test
    fun `native success followed by response loss can be completed again and preserves next FIFO token`() {
        val root = root()
        val store = PendingPetArchiveStore(root)
        val first = add(store)
        val second = add(store)
        val queue = PendingPetImportQueue(store)

        assertEquals(first.token, queue.nextAnnouncement())
        queue.claim(first.token)
        assertEquals(second.token, queue.finish(first.token, PendingArchiveOutcome.IMPORTED))

        val restoredQueue = PendingPetImportQueue(PendingPetArchiveStore(root))
        assertEquals(second.token, restoredQueue.nextAnnouncement())
        assertEquals(second.token, restoredQueue.finish(first.token, PendingArchiveOutcome.IMPORTED))
        assertEquals(second.token, restoredQueue.claim(second.token).name.substringAfter("pet-").removeSuffix(".zip"))
    }

    @Test
    fun `missing file for the current claim releases it and advances FIFO`() {
        val store = PendingPetArchiveStore(root())
        val first = add(store)
        val second = add(store)
        val queue = PendingPetImportQueue(store)
        queue.nextAnnouncement()
        queue.claim(first.token)
        assertTrue(store.pendingFiles().first { it.name == "${first.token}.zip" }.delete())

        assertEquals(second.token, queue.finish(first.token, PendingArchiveOutcome.REJECTED))
        assertEquals(second.token, queue.claim(second.token).name.substringAfter("pet-").removeSuffix(".zip"))
    }

    @Test
    fun `duplicate completion succeeds but an unknown token cannot disturb a different claim`() {
        val store = PendingPetArchiveStore(root())
        val first = add(store)
        val second = add(store)
        val queue = PendingPetImportQueue(store)
        queue.nextAnnouncement()
        queue.claim(first.token)
        assertEquals(second.token, queue.finish(first.token, PendingArchiveOutcome.CANCELLED))
        assertEquals(second.token, queue.finish(first.token, PendingArchiveOutcome.CANCELLED))
        queue.claim(second.token)

        assertThrows(IllegalArgumentException::class.java) {
            queue.finish("unknown-token", PendingArchiveOutcome.REJECTED)
        }
        assertEquals(null, queue.finish(second.token, PendingArchiveOutcome.IMPORTED))
        assertEquals(null, queue.finish(second.token, PendingArchiveOutcome.IMPORTED))
    }

    @Test
    fun `completed token history remains bounded on disk`() {
        val root = root()
        val store = PendingPetArchiveStore(root)
        repeat(24) {
            val archive = add(store)
            store.acknowledge(archive.token)
        }

        val completed = File(root, "pending-pet-archives").listFiles().orEmpty()
            .count { it.name.endsWith(".done") }
        assertTrue(completed in 1..16)
    }
}
