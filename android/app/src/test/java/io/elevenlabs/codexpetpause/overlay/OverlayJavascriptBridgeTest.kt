package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OverlayJavascriptBridgeTest {
    @Test
    fun bubbleMeasurementRequiresModeAndGeneration() {
        val received = mutableListOf<OverlayWebMessage>()
        val bridge = OverlayJavascriptBridge(received::add)

        bridge.postMessage("""{"type":"bubble-size-changed","widthDp":280,"heightDp":340}""")
        bridge.postMessage("""{"type":"bubble-size-changed","mode":"MENU","generation":4,"widthDp":72,"heightDp":72}""")
        bridge.postMessage("""{"type":"bubble-size-changed","mode":"BUBBLE","generation":4,"widthDp":280,"heightDp":340}""")

        assertEquals(1, received.size)
        val size = received.single()
        assertTrue(size is OverlayWebMessage.BubbleSizeChanged)
        size as OverlayWebMessage.BubbleSizeChanged
        assertEquals("BUBBLE", size.mode)
        assertEquals(4L, size.generation)
        assertEquals(280, size.widthDp)
        assertEquals(340, size.heightDp)
    }

    @Test
    fun surfaceAcknowledgementRequiresKnownModeAndGeneration() {
        val received = mutableListOf<OverlayWebMessage>()
        val bridge = OverlayJavascriptBridge(received::add)

        bridge.postMessage("""{"type":"surface-rendered","mode":"PET","generation":2}""")
        bridge.postMessage("""{"type":"surface-rendered","mode":"MENU","generation":-1}""")
        bridge.postMessage("""{"type":"surface-rendered","mode":"MENU","generation":2}""")

        assertEquals(listOf(OverlayWebMessage.SurfaceRendered("MENU", 2)), received)
    }

    @Test
    fun menuCloseUsesTheTypedMenuActionContract() {
        val received = mutableListOf<OverlayWebMessage>()
        val bridge = OverlayJavascriptBridge(received::add)

        bridge.postMessage("""{"type":"menu-action","action":"close"}""")

        assertEquals(listOf(OverlayWebMessage.MenuAction(OverlayMenuAction.CLOSE)), received)
    }

    @Test
    fun detachedSurfaceReadyRequiresExactModeAndGeneration() {
        val received = mutableListOf<DetachedOverlayWebMessage>()
        val bridge = OverlayJavascriptBridge.forDetached(received::add)

        bridge.postMessage("""{"type":"surface-ready"}""")
        bridge.postMessage("""{"type":"surface-ready","mode":"PET","generation":4}""")
        bridge.postMessage("""{"type":"surface-ready","mode":"MENU","generation":-1}""")
        bridge.postMessage("""{"type":"surface-ready","mode":"MENU","generation":4.5}""")
        bridge.postMessage("""{"type":"surface-ready","mode":"MENU","generation":4}""")
        bridge.postMessage("""{"type":"surface-ready","mode":"MENU","generation":4}""")

        assertEquals(2, received.size)
        received.forEach { message ->
            val mode = message.javaClass.getDeclaredField("mode").apply { isAccessible = true }.get(message)
            val generation = message.javaClass.getDeclaredField("generation").apply { isAccessible = true }.get(message)
            assertEquals(DetachedSurfaceMode.MENU, mode)
            assertEquals(4L, generation)
        }
    }

    @Test
    fun detachedMeasurementsRequireExactModeGenerationAndIntegerBoundedDimensions() {
        val received = mutableListOf<DetachedOverlayWebMessage>()
        val bridge = OverlayJavascriptBridge.forDetached(received::add)

        bridge.postMessage("""{"type":"surface-size-changed","mode":"PET","generation":4,"widthDp":100,"heightDp":100}""")
        bridge.postMessage("""{"type":"surface-size-changed","mode":"MENU","generation":-1,"widthDp":100,"heightDp":100}""")
        bridge.postMessage("""{"type":"surface-size-changed","mode":"MENU","generation":4.5,"widthDp":100,"heightDp":100}""")
        bridge.postMessage("""{"type":"surface-size-changed","mode":"MENU","generation":4,"widthDp":100.5,"heightDp":100}""")
        bridge.postMessage("""{"type":"surface-size-changed","mode":"MENU","generation":4,"widthDp":0,"heightDp":100}""")
        bridge.postMessage("""{"type":"surface-size-changed","mode":"MENU","generation":4,"widthDp":601,"heightDp":100}""")
        bridge.postMessage("""{"type":"surface-size-changed","mode":"MENU","generation":4,"widthDp":305,"heightDp":248}""")

        assertEquals(
            listOf(DetachedOverlayWebMessage.SurfaceSizeChanged(DetachedSurfaceMode.MENU, 4, 305, 248)),
            received,
        )
    }

    @Test
    fun detachedMenuActionsAreTypedAndRequireMenuModeWithoutReminderFields() {
        val received = mutableListOf<DetachedOverlayWebMessage>()
        val bridge = OverlayJavascriptBridge.forDetached(received::add)

        listOf("close", "settings", "hide", "quit").forEach { action ->
            bridge.postMessage("""{"type":"surface-action","mode":"MENU","generation":7,"action":"$action"}""")
        }
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":7,"action":"close"}""")
        bridge.postMessage("""{"type":"surface-action","mode":"MENU","generation":7,"action":"hide","reminderId":"lookAway"}""")
        bridge.postMessage("""{"type":"surface-action","mode":"MENU","generation":7,"action":"quit","snoozeMinutes":5}""")

        assertEquals(
            listOf(
                DetachedSurfaceAction.Menu(7, OverlayMenuAction.CLOSE),
                DetachedSurfaceAction.Menu(7, OverlayMenuAction.SETTINGS),
                DetachedSurfaceAction.Menu(7, OverlayMenuAction.HIDE),
                DetachedSurfaceAction.Menu(7, OverlayMenuAction.QUIT),
            ),
            received.map { (it as DetachedOverlayWebMessage.SurfaceAction).action },
        )
    }

    @Test
    fun detachedBubbleActionsRequireReminderContractAndExactSnoozeMinutes() {
        val received = mutableListOf<DetachedOverlayWebMessage>()
        val bridge = OverlayJavascriptBridge.forDetached(received::add)

        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"complete","reminderId":"lookAway"}""")
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"skip","reminderId":"lookAway"}""")
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"snooze","reminderId":"lookAway","snoozeMinutes":10}""")
        bridge.postMessage("""{"type":"surface-action","mode":"MENU","generation":8,"action":"skip","reminderId":"lookAway"}""")
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"complete","reminderId":"lookAway","snoozeMinutes":5}""")
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"snooze","reminderId":"lookAway","snoozeMinutes":6}""")
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"skip","reminderId":""}""")
        bridge.postMessage("""{"type":"surface-action","mode":"BUBBLE","generation":8,"action":"skip","reminderId":"${"x".repeat(65)}"}""")

        assertEquals(
            listOf(
                DetachedSurfaceAction.Reminder(8, "lookAway", OverlayReminderAction.COMPLETE),
                DetachedSurfaceAction.Reminder(8, "lookAway", OverlayReminderAction.SKIP),
                DetachedSurfaceAction.Reminder(8, "lookAway", OverlayReminderAction.SNOOZE, 10),
            ),
            received.map { (it as DetachedOverlayWebMessage.SurfaceAction).action },
        )
    }
}
