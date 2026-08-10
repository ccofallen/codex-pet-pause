package io.elevenlabs.codexpetpause.overlay

internal class OverlayWebEventGate<T>(private val capacity: Int = 8) {
    private val pending = ArrayDeque<T>()
    private var ready = false

    init {
        require(capacity > 0)
    }

    fun reset() {
        ready = false
        pending.clear()
    }

    fun send(event: T, dispatch: (T) -> Unit) {
        if (ready) {
            dispatch(event)
            return
        }
        if (pending.size == capacity) pending.removeFirst()
        pending.addLast(event)
    }

    fun markReady(sendCurrentState: () -> Unit, dispatch: (T) -> Unit) {
        if (ready) {
            sendCurrentState()
            return
        }
        ready = true
        sendCurrentState()
        while (pending.isNotEmpty()) dispatch(pending.removeFirst())
    }
}
