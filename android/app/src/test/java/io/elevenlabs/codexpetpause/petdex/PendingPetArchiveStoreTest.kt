package io.elevenlabs.codexpetpause.petdex

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun acceptedArchiveCanBeConsumedOnlyOnceAndIsDeleted() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)
        val bytes = validZip(12)
        val pending = store.accept(ByteArrayInputStream(bytes), "application/zip", "momo.zip")

        assertEquals(listOf(pending.token), store.pendingTokens())
        assertArrayEquals(bytes, store.consume(pending.token).bytes)
        assertTrue(store.pendingFiles().isEmpty())
        assertThrows(PendingArchiveMissing::class.java) { store.consume(pending.token) }
    }

    @Test
    fun invalidZipContentAndUnsafeTokensNeverEscapeThePrivateDirectory() {
        val store = PendingPetArchiveStore(temporary.root, maxArchiveBytes = 32)

        assertThrows(InvalidPetArchive::class.java) {
            store.accept(ByteArrayInputStream("not-a-zip".toByteArray()), "application/zip", "momo.zip")
        }
        assertThrows(IllegalArgumentException::class.java) { store.consume("../escape") }
        assertTrue(store.pendingFiles().isEmpty())
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
