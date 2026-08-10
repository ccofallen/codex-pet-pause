package io.elevenlabs.codexpetpause.bridge

import java.util.concurrent.CopyOnWriteArrayList

internal object AndroidCommittedStateBus {
    private val listeners = CopyOnWriteArrayList<(Long) -> Unit>()

    fun publish(revision: Long) {
        listeners.forEach { listener -> runCatching { listener(revision) } }
    }

    fun subscribe(listener: (Long) -> Unit): () -> Unit {
        listeners += listener
        return { listeners -= listener }
    }
}
