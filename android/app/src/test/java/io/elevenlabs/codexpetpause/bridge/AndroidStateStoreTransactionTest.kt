package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidStateStoreTransactionTest {
    @Test fun stateWriteFailureLeavesExistingPetUntouched() {
        val fs = TransactionFileSystem().apply { state = valid("old"); failStateWrite = true }
        val store = AndroidStateStore(File("/state"), fs)
        assertThrows(IOException::class.java) { store.savePetAndSnapshot("momo", "{\"id\":\"momo\"}", "c3ByaXRl", valid("new")) }
        assertEquals(valid("old"), fs.state)
        assertEquals("old", fs.pet)
    }
    @Test fun deleteFailureRestoresStateAndActivePetAssets() {
        val fs = TransactionFileSystem().apply { state = valid("old"); pet = "old"; failReplace = true }
        val store = AndroidStateStore(File("/state"), fs)
        assertThrows(IOException::class.java) { store.deletePetAndSnapshot("momo", valid("new")) }
        assertEquals(valid("old"), fs.state); assertEquals("old", fs.pet)
    }
    private fun valid(name: String) = "{\"schemaVersion\":1,\"settingsJson\":\"{}\",\"historyJson\":[],\"pets\":[],\"overlay\":{\"xRatio\":0.5,\"yRatio\":0.5},\"name\":\"$name\"}"
}
private class TransactionFileSystem : StateFileSystem {
    var state: String? = null; var pet = "old"; var failStateWrite = false; var failReplace = false
    override fun readText(file: File) = state
    override fun writeAtomically(file: File, value: String) { if (failStateWrite) throw IOException("state"); state = value }
    override fun createTemporarySibling(target: File) = File("/tmp")
    override fun writeFile(file: File, value: ByteArray) = Unit
    override fun replaceDirectory(temporary: File, target: File) { if (failReplace) { failReplace = false; throw IOException("replace") }; pet = if (target.name.contains("tmp")) "backup" else "old" }
    override fun deleteRecursively(file: File) = Unit
}
