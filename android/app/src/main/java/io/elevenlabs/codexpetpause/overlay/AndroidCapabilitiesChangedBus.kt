package io.elevenlabs.codexpetpause.overlay

internal object AndroidCapabilitiesChangedBus {
    private val listeners = LinkedHashSet<() -> Unit>()

    @Synchronized
    fun subscribe(listener: () -> Unit): () -> Unit {
        listeners += listener
        return { unsubscribe(listener) }
    }

    @Synchronized
    private fun unsubscribe(listener: () -> Unit) {
        listeners -= listener
    }

    fun publish(): Int {
        val snapshot = synchronized(this) { listeners.toList() }
        snapshot.forEach { it() }
        return snapshot.size
    }
}
