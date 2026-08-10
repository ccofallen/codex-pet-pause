package io.elevenlabs.codexpetpause.web

import java.util.concurrent.atomic.AtomicBoolean

class RendererRecoveryGate {
    private val started = AtomicBoolean(false)

    fun tryBegin(): Boolean = started.compareAndSet(false, true)
}
