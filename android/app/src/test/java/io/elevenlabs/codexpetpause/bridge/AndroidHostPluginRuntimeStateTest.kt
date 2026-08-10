package io.elevenlabs.codexpetpause.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidHostPluginRuntimeStateTest {
    @Test
    fun committedRuntimeEventUsesTheExactLightweightPluginContract() {
        val event = androidRuntimeStateChangedEvent(42L)

        assertEquals("stateChanged", event.name)
        assertEquals(setOf("type", "revision"), event.payload.keys().asSequence().toSet())
        assertEquals("runtimeStateChanged", event.payload.getString("type"))
        assertEquals(42L, event.payload.getLong("revision"))
        assertFalse(event.payload.has("snapshot"))
        assertFalse(event.payload.has("pets"))
        assertFalse(event.payload.has("overlay"))
        assertFalse(event.payload.has("spritesheetBase64"))
        assertFalse(event.payload.toString().contains("base64", ignoreCase = true))
    }
}
