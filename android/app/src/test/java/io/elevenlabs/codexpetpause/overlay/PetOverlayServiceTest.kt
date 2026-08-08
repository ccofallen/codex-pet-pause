package io.elevenlabs.codexpetpause.overlay

import android.graphics.PixelFormat
import android.net.Uri
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import java.util.ArrayDeque
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PetOverlayServiceTest {
    @Test
    fun windowUsesTransparentMinimalBoundsLayout() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()

        val params = service.createPetLayoutParams(widthPx = 72, heightPx = 96, xPx = 8, yPx = 16)

        assertEquals(PixelFormat.TRANSLUCENT, params.format)
        assertEquals(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, params.type)
        assertTrue(params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE != 0)
        assertNotEquals(WindowManager.LayoutParams.MATCH_PARENT, params.width)
        assertNotEquals(WindowManager.LayoutParams.MATCH_PARENT, params.height)
        assertEquals(72, params.width)
        assertEquals(96, params.height)
        assertEquals(8, params.x)
        assertEquals(16, params.y)
    }

    @Test
    fun webViewAllowsOnlyBundledLocalOriginsAndDisablesAmbientFileAccess() {
        val factory = OverlayWebViewFactory(ApplicationProvider.getApplicationContext()) { }
        val webView = factory.create()

        assertFalse(webView.settings.allowFileAccess)
        assertFalse(webView.settings.allowContentAccess)
        assertFalse(webView.settings.allowFileAccessFromFileURLs)
        assertFalse(webView.settings.allowUniversalAccessFromFileURLs)
        assertTrue(factory.isAllowedUri(Uri.parse(OverlayWebViewFactory.OVERLAY_URL)))
        assertTrue(factory.isAllowedUri(Uri.parse(
            "https://appassets.androidplatform.net/local-files/pets/momo/0123456789abcdef0123456789abcdef/spritesheet.webp",
        )))
        assertFalse(factory.isAllowedUri(Uri.parse("https://example.com/overlay")))
        assertFalse(factory.isAllowedUri(Uri.parse("file:///sdcard/pet.webp")))
        assertFalse(factory.isAllowedUri(Uri.parse("content://media/external/pet.webp")))
    }

    @Test
    fun javascriptBridgeExposesOneTypedMessageMethodAndRejectsUnknownMessages() {
        val accepted = mutableListOf<OverlayWebMessage>()
        val bridge = OverlayJavascriptBridge(accepted::add)
        val exposed = OverlayJavascriptBridge::class.java.methods
            .filter { it.getAnnotation(android.webkit.JavascriptInterface::class.java) != null }

        bridge.postMessage("""{"type":"menu-action","action":"quit"}""")
        bridge.postMessage("""{"type":"navigate","url":"https://example.com"}""")

        assertEquals(listOf("postMessage"), exposed.map { it.name })
        assertEquals(listOf(OverlayWebMessage.MenuAction(OverlayMenuAction.QUIT)), accepted)
    }

    @Test
    fun serviceDispatcherSchedulesWaitOneMillisecondPastTheDoubleTapBoundary() {
        val scheduler = RecordingWaitScheduler()
        val results = mutableListOf<OverlayGestureResult>()
        val dispatcher = OverlayGestureDispatcher(interpreter(), scheduler, results::add)

        dispatcher.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 0))
        dispatcher.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 16))

        assertEquals(267L, scheduler.deadlineMs)
        scheduler.runScheduled()
        assertEquals(listOf(SingleTap), results)
    }

    @Test
    fun scheduledWaitCannotStealAQualifyingSecondTap() {
        val scheduler = RecordingWaitScheduler()
        val results = mutableListOf<OverlayGestureResult>()
        val dispatcher = OverlayGestureDispatcher(interpreter(), scheduler, results::add)

        dispatcher.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 0))
        dispatcher.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 0))
        dispatcher.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 250))
        scheduler.runScheduled()
        dispatcher.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 301))

        assertEquals(listOf(OpenMenu), results)
    }

    @Test
    fun declaresOnlyTheRequiredServiceCommands() {
        assertEquals(
            setOf("START", "SHOW", "HIDE", "QUIT", "STATE_CHANGED"),
            PetOverlayService.COMMANDS,
        )
    }

    private fun interpreter() = OverlayGestureInterpreter(
        bounds = Bounds(widthDp = 400, heightDp = 800),
        geometry = OverlayGeometry(defaultSizeDp = 72),
        initialPlacement = OverlayPlacement(200, 300, 72, Attachment.Free),
        touchSlopDp = 8,
        doubleTapWindowMs = 250,
    )
}

private class RecordingWaitScheduler : OverlayWaitScheduler {
    var deadlineMs: Long? = null
    private var scheduled: (() -> Unit)? = null

    override fun scheduleAt(deadlineMs: Long, action: () -> Unit) {
        this.deadlineMs = deadlineMs
        scheduled = action
    }

    override fun cancel() {
        deadlineMs = null
        scheduled = null
    }

    fun runScheduled() {
        val action = scheduled
        scheduled = null
        deadlineMs = null
        action?.invoke()
    }
}
