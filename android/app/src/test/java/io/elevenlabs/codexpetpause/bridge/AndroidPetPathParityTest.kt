package io.elevenlabs.codexpetpause.bridge

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidPetPathParityTest {
    private val revision = "0123456789abcdef0123456789abcdef"

    @Test
    fun dottedPetIdsProduceCanonicalAssetPaths() {
        val directory = AndroidStateValidator.assetDirectory(
            File("/state"),
            "pets/moon.cat/$revision/spritesheet.webp",
        )

        assertEquals("moon.cat", directory.parentFile?.name)
        assertEquals(revision, directory.name)
    }

    @Test
    fun assetPathsRejectTraversalEmptyDotEncodedSeparatorsAndUnsafeCharacters() {
        listOf(
            "pets//$revision/spritesheet.webp",
            "pets/./$revision/spritesheet.webp",
            "pets/../$revision/spritesheet.webp",
            "pets/moon%2Fcat/$revision/spritesheet.webp",
            "pets/moon%5Ccat/$revision/spritesheet.webp",
            "pets/moon cat/$revision/spritesheet.webp",
            "pets/moon.cat/$revision/../spritesheet.webp",
        ).forEach { path ->
            assertThrows(path, IllegalArgumentException::class.java) {
                AndroidStateValidator.assetDirectory(File("/state"), path)
            }
        }
    }
}
