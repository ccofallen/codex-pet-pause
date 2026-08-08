package io.elevenlabs.codexpetpause.bridge

import android.util.AtomicFile
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Base64
import java.util.UUID

internal interface StateFileSystem {
    fun readText(file: File): String?
    fun writeAtomically(file: File, value: String)
    fun createTemporarySibling(target: File): File
    fun writeFile(file: File, value: ByteArray)
    fun replaceDirectory(temporary: File, target: File)
    fun deleteRecursively(file: File)
}

internal class AndroidStateFileSystem : StateFileSystem {
    override fun readText(file: File): String? = if (file.exists()) file.readText(Charsets.UTF_8) else null

    override fun writeAtomically(file: File, value: String) {
        file.parentFile?.mkdirs()
        val atomicFile = AtomicFile(file)
        var stream: FileOutputStream? = null
        try {
            stream = atomicFile.startWrite()
            stream.write(value.toByteArray(Charsets.UTF_8))
            atomicFile.finishWrite(stream)
            stream = null
        } catch (error: IOException) {
            if (stream != null) atomicFile.failWrite(stream)
            throw error
        }
    }

    override fun createTemporarySibling(target: File): File {
        val parent = target.parentFile ?: throw IOException("Pet directory has no parent")
        parent.mkdirs()
        return File(parent, ".${target.name}.${UUID.randomUUID()}.tmp")
    }

    override fun writeFile(file: File, value: ByteArray) {
        file.parentFile?.mkdirs()
        file.outputStream().use { it.write(value) }
    }

    override fun replaceDirectory(temporary: File, target: File) {
        val parent = target.parentFile ?: throw IOException("Pet directory has no parent")
        val backup = File(parent, ".${target.name}.${UUID.randomUUID()}.backup")
        val hadTarget = target.exists()
        if (hadTarget && !target.renameTo(backup)) throw IOException("Could not preserve existing pet")
        try {
            if (!temporary.renameTo(target)) throw IOException("Could not replace pet assets")
            if (hadTarget) deleteRecursively(backup)
        } catch (error: IOException) {
            if (hadTarget && !target.exists()) backup.renameTo(target)
            throw error
        }
    }

    override fun deleteRecursively(file: File) {
        if (!file.exists()) return
        file.walkBottomUp().forEach { if (!it.delete()) throw IOException("Could not delete ${it.path}") }
    }
}

internal class AndroidStateStore(
    internal val filesDir: File,
    internal val fileSystem: StateFileSystem = AndroidStateFileSystem(),
) {
    private val stateFile = File(filesDir, "state.json")
    internal val safePetId = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

    fun readSnapshot(): String? = fileSystem.readText(stateFile)

    fun writeSnapshot(snapshotJson: String) {
        require(snapshotJson.contains("\"schemaVersion\":1")) { "Unsupported Android state schema" }
        fileSystem.writeAtomically(stateFile, snapshotJson)
    }

    fun writePet(id: String, metadataJson: String, spritesheetBase64: String) {
        require(safePetId.matches(id)) { "Unsafe Android pet id" }
        require(metadataJson.trim().startsWith("{") && metadataJson.trim().endsWith("}")) {
            "Invalid Android pet metadata"
        }
        val spritesheet = try {
            Base64.getDecoder().decode(spritesheetBase64)
        } catch (error: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid Android pet spritesheet", error)
        }
        require(spritesheet.isNotEmpty()) { "Invalid Android pet spritesheet" }
        val target = File(File(filesDir, "pets"), id)
        val temporary = fileSystem.createTemporarySibling(target)
        try {
            fileSystem.writeFile(File(temporary, "pet.json"), metadataJson.toByteArray(Charsets.UTF_8))
            fileSystem.writeFile(File(temporary, "spritesheet.webp"), spritesheet)
            fileSystem.replaceDirectory(temporary, target)
        } catch (error: Throwable) {
            fileSystem.deleteRecursively(temporary)
            throw error
        }
    }

    fun deletePet(id: String) {
        require(safePetId.matches(id)) { "Unsafe Android pet id" }
        fileSystem.deleteRecursively(File(File(filesDir, "pets"), id))
    }
}

internal fun AndroidStateStore.savePetAndSnapshot(id: String, metadataJson: String, spritesheetBase64: String, snapshotJson: String) {
    val previous = readSnapshot()
    writeSnapshot(snapshotJson)
    try { writePet(id, metadataJson, spritesheetBase64) }
    catch (error: Throwable) { if (previous != null) writeSnapshot(previous); throw error }
}
internal fun AndroidStateStore.deletePetAndSnapshot(id: String, snapshotJson: String) {
    require(safePetId.matches(id)) { "Unsafe Android pet id" }
    val previous = readSnapshot()
    val target = File(File(filesDir, "pets"), id)
    val backup = fileSystem.createTemporarySibling(target)
    var phase = "backup"
    try {
        fileSystem.replaceDirectory(target, backup)
        phase = "snapshot"
        writeSnapshot(snapshotJson)
        phase = "cleanup"
        fileSystem.deleteRecursively(backup)
    } catch (error: Throwable) {
        var recovery: Throwable? = null
        try {
            fileSystem.replaceDirectory(backup, target)
        } catch (restore: Throwable) {
            recovery = restore
        }
        try {
            if (previous != null) writeSnapshot(previous)
        } catch (restore: Throwable) {
            if (recovery == null) recovery = restore
        }
        val state = if (recovery == null) "complete" else "failed"
        throw IOException("delete transaction failed during $phase; recovery=$state", error).also {
            if (recovery != null) it.addSuppressed(recovery)
        }
    }
}
