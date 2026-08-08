package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.io.IOException
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue

class AndroidStateStoreTest {
    @Test
    fun failedReplacementKeepsPreviousState() {
        val fileSystem = FailingStateFileSystem()
        val store = AndroidStateStore(File("/state"), fileSystem)
        val validSnapshot = """{"schemaVersion":1,"settingsJson":"{}","historyJson":[],"pets":[],"overlay":{"xRatio":0.5,"yRatio":0.5}}"""
        val replacement = """{"schemaVersion":1,"settingsJson":"{\\"theme\\":\\"dark\\"}","historyJson":[],"pets":[],"overlay":{"xRatio":0.5,"yRatio":0.5}}"""

        store.writeSnapshot(validSnapshot)
        fileSystem.failNextAtomicWrite()

        assertThrows(IOException::class.java) { store.writeSnapshot(replacement) }
        assertEquals(validSnapshot, store.readSnapshot())
    }

    @Test
    fun rejectsDangerousPetIdsBeforeCreatingAssetDirectories() {
        val fileSystem = FailingStateFileSystem()
        val store = AndroidStateStore(File("/state"), fileSystem)

        assertThrows(IllegalArgumentException::class.java) {
            store.writePet("../escape", "{\"id\":\"escape\"}", "c3ByaXRl")
        }

        assertTrue(fileSystem.createdDirectories.isEmpty())
    }
}

private class FailingStateFileSystem : StateFileSystem {
    private var state: String? = null
    private var shouldFailAtomicWrite = false
    val createdDirectories = mutableListOf<File>()

    fun failNextAtomicWrite() {
        shouldFailAtomicWrite = true
    }

    override fun readText(file: File): String? = state

    override fun writeAtomically(file: File, value: String) {
        if (shouldFailAtomicWrite) {
            shouldFailAtomicWrite = false
            throw IOException("atomic move failed")
        }
        state = value
    }

    override fun createTemporarySibling(target: File): File {
        return File(target.parentFile, ".${target.name}.tmp").also(createdDirectories::add)
    }

    override fun writeFile(file: File, value: ByteArray) = Unit

    override fun replaceDirectory(temporary: File, target: File) = Unit

    override fun deleteRecursively(file: File) = Unit
}
