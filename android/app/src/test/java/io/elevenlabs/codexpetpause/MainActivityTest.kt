package io.elevenlabs.codexpetpause

import io.elevenlabs.codexpetpause.web.RendererRecoveryGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk = [35])
class MainActivityTest {
    @Test
    fun recoveryLaunchIntentPreservesTheExistingLaunchContract() {
        val original = android.content.Intent("io.elevenlabs.codexpetpause.OPEN")
            .setData(android.net.Uri.parse("codexpetpause://petdex/import"))
            .putExtra("archive", "momo.zip")
        val component = android.content.ComponentName("io.elevenlabs.codexpetpause", MainActivity::class.java.name)

        val recovered = MainActivity.recoveryLaunchIntent(original, component)

        assertEquals(original.action, recovered.action)
        assertEquals(original.data, recovered.data)
        assertEquals("momo.zip", recovered.getStringExtra("archive"))
        assertEquals(component, recovered.component)
        assertTrue((recovered.flags.toInt() and android.content.Intent.FLAG_ACTIVITY_NEW_TASK) != 0)
        assertTrue((recovered.flags.toInt() and android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP) != 0)
    }

    @Test
    fun capacitorWebViewListenerCallbackRelaunchesOnlyOnce() {
        val actions = mutableListOf<String>()
        val listener = MainActivity.createRendererRecoveryListener(
            RendererRecoveryGate(),
            { actions += "finish" },
            { actions += "relaunch" },
        )

        assertTrue(listener.onRenderProcessGone(null, rendererGoneDetail()))
        assertTrue(listener.onRenderProcessGone(null, rendererGoneDetail()))

        assertEquals(listOf("finish", "relaunch"), actions)
    }

    @Test
    fun rendererLossFinishesAndRelaunchesOnlyOnce() {
        val actions = mutableListOf<String>()
        val gate = RendererRecoveryGate()

        assertTrue(MainActivity.handleRendererLoss(gate, { actions += "finish" }, { actions += "relaunch" }))
        assertTrue(MainActivity.handleRendererLoss(gate, { actions += "finish" }, { actions += "relaunch" }))

        assertEquals(listOf("finish", "relaunch"), actions)
    }
}

private fun rendererGoneDetail() = object : android.webkit.RenderProcessGoneDetail() {
    override fun didCrash(): Boolean = false
    override fun rendererPriorityAtExit(): Int = 0
}
