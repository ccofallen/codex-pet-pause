package io.elevenlabs.codexpetpause.overlay

import android.graphics.PixelFormat
import android.net.Uri
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import java.io.File
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
        assertEquals("", params.title?.toString().orEmpty())
    }

    @Test
    fun bundledOverlayEntryResolvesFromThePackagedPublicAssetsDirectory() {
        val factory = OverlayWebViewFactory(ApplicationProvider.getApplicationContext()) { }
        val response = factory.intercept(Uri.parse(OverlayWebViewFactory.OVERLAY_URL))

        assertEquals("https://appassets.androidplatform.net/app/index.html?overlay=1", OverlayWebViewFactory.OVERLAY_URL)
        assertEquals(200, response.statusCode)
        assertEquals("text/html", response.mimeType)
        assertTrue(response.data.readBytes().isNotEmpty())
    }

    @Test
    fun webViewAllowsOnlyBundledPublicAssetsAndImmutablePetSpritesheets() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val factory = OverlayWebViewFactory(context) { }
        val revision = "fedcba9876543210fedcba9876543210"
        val petRoot = File(context.filesDir, "pets/review-pet")
        val spritesheet = File(petRoot, "$revision/spritesheet.webp")
        val state = File(context.filesDir, "state.json")
        spritesheet.parentFile!!.mkdirs()
        spritesheet.writeBytes(byteArrayOf(1, 2, 3))
        state.writeText("sensitive")
        val webView = factory.create()

        try {
            assertFalse(webView.settings.allowFileAccess)
            assertFalse(webView.settings.allowContentAccess)
            assertFalse(webView.settings.allowFileAccessFromFileURLs)
            assertFalse(webView.settings.allowUniversalAccessFromFileURLs)
            assertTrue(webView.settings.blockNetworkLoads)
            assertTrue(factory.isAllowedUri(Uri.parse(OverlayWebViewFactory.OVERLAY_URL)))
            val petUri = Uri.parse(
                "https://appassets.androidplatform.net/pet-assets/pets/review-pet/$revision/spritesheet.webp",
            )
            assertTrue(factory.isAllowedUri(petUri))
            assertEquals(200, factory.intercept(petUri).statusCode)
            assertEquals("image/webp", factory.intercept(petUri).mimeType)
            assertFalse(factory.isAllowedUri(Uri.parse("https://appassets.androidplatform.net/pet-assets/state.json")))
            assertEquals(
                403,
                factory.intercept(Uri.parse("https://appassets.androidplatform.net/pet-assets/state.json")).statusCode,
            )
            assertEquals(
                403,
                factory.intercept(Uri.parse(
                    "https://appassets.androidplatform.net/pet-assets/pets/review-pet/$revision/metadata.json",
                )).statusCode,
            )
        } finally {
            petRoot.deleteRecursively()
            state.delete()
            webView.destroy()
        }
    }

    @Test
    fun webViewBlocksRemoteHttpSubresourcesAndNavigationFromTheBridgedPage() {
        val factory = OverlayWebViewFactory(ApplicationProvider.getApplicationContext()) { }

        listOf("http://example.com/tracker.js", "https://example.com/pet.webp").forEach { value ->
            val uri = Uri.parse(value)
            assertFalse(factory.isAllowedUri(uri))
            assertEquals(403, factory.intercept(uri).statusCode)
        }
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
    fun serviceDispatcherSchedulesWaitAtTheSharedDoubleTapBoundary() {
        val scheduler = RecordingWaitScheduler()
        val results = mutableListOf<OverlayGestureResult>()
        val dispatcher = OverlayGestureDispatcher(interpreter(), scheduler, results::add)

        dispatcher.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 0))
        dispatcher.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 16))

        assertEquals(266L, scheduler.deadlineMs)
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
