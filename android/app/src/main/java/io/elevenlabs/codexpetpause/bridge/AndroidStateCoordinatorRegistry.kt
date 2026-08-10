package io.elevenlabs.codexpetpause.bridge

import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** One coordinator, store, and transaction monitor per process/state file. */
internal object AndroidStateCoordinatorRegistry {
    private val coordinators = ConcurrentHashMap<String, AndroidStateCoordinator>()

    fun forFilesDir(filesDir: File): AndroidStateCoordinator {
        val key = filesDir.canonicalFile.path
        return coordinators.computeIfAbsent(key) {
            AndroidStateCoordinator(AndroidStateStore(filesDir))
        }
    }

    internal fun clearForTests() {
        coordinators.clear()
    }
}
