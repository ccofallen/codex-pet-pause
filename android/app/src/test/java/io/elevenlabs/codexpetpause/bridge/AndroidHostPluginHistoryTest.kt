package io.elevenlabs.codexpetpause.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidHostPluginHistoryTest {
    @Test
    fun pruneHistoryAcceptsCapacitorLongAndFractionalNumericCutoffs() {
        val plugin = plugin()

        listOf(1_778_525_447_031L, 1_778_525_447_031.5).forEach { cutoff ->
            val call = RecordingPluginCall(JSObject().put("before", cutoff))

            plugin.pruneHistory(call)

            assertTrue("cutoff $cutoff should resolve", call.resolved)
            assertNull("cutoff $cutoff should not reject", call.rejection)
        }
    }

    @Test
    fun pruneHistoryRejectsUnsafeNumericCutoffsWithoutTreatingThemAsMissing() {
        val plugin = plugin()

        listOf(-1L, Long.MAX_VALUE, "1778525447031").forEach { cutoff ->
            val call = RecordingPluginCall(JSObject().put("before", cutoff))

            plugin.pruneHistory(call)

            assertEquals("invalid history cutoff", call.rejection)
        }
    }

    @Test
    fun pruneHistoryStillReportsAMissingCutoffPrecisely() {
        val call = RecordingPluginCall(JSObject())

        plugin().pruneHistory(call)

        assertEquals("history cutoff is required", call.rejection)
    }

    private fun plugin(): AndroidHostPlugin {
        val directory = Files.createTempDirectory("android-host-history-test").toFile()
        val plugin = AndroidHostPlugin()
        AndroidHostPlugin::class.java.getDeclaredField("coordinator").apply {
            isAccessible = true
            set(plugin, AndroidStateCoordinator(AndroidStateStore(directory)))
        }
        return plugin
    }

    private class RecordingPluginCall(data: JSObject) : PluginCall(
        null,
        "AndroidHost",
        "test-callback",
        "pruneHistory",
        data,
    ) {
        var resolved = false
        var rejection: String? = null

        override fun resolve(data: JSObject) {
            resolved = true
        }

        override fun reject(message: String) {
            rejection = message
        }
    }
}
