package io.elevenlabs.codexpetpause.web

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RendererRecoveryGateTest {
    @Test
    fun permitsRecoveryOnlyOncePerRendererInstance() {
        val gate = RendererRecoveryGate()

        assertTrue(gate.tryBegin())
        assertFalse(gate.tryBegin())
    }
}
