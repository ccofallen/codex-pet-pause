package io.elevenlabs.codexpetpause.overlay

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Parcel
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import java.util.IdentityHashMap
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@LooperMode(LooperMode.Mode.PAUSED)
class DetachedOverlaySurfaceControllerTest {
    private lateinit var context: Context
    private lateinit var windows: RecordingWindowManager
    private lateinit var webViews: RecordingDetachedWebViewFactory
    private lateinit var controller: DetachedOverlaySurfaceController
    private val actions = mutableListOf<DetachedSurfaceAction>()
    private val losses = mutableListOf<DetachedSurfaceLoss>()
    private var anchor = OverlayPlacement(40, 200, 72, Attachment.Free)
    private var screen = Bounds(widthDp = 400, heightDp = 800)

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        windows = RecordingWindowManager(
            context.getSystemService(Context.WINDOW_SERVICE) as WindowManager,
        )
        webViews = RecordingDetachedWebViewFactory(context)
        controller = DetachedOverlaySurfaceController(
            context = context,
            windowManager = windows,
            handler = Handler(Looper.getMainLooper()),
            screenBoundsProvider = { screen },
            anchorProvider = { anchor },
            snapshotProvider = { JSONObject("""{"schemaVersion":3}""") },
            webViewFactory = webViews,
            onAction = actions::add,
            onSurfaceLost = losses::add,
        )
    }

    @Test
    fun constructorDoesNotCreateAWindow() {
        assertNull(controller.activeSurface)
        assertEquals(0, windows.addCount)
        assertEquals(0, webViews.created.size)
    }

    @Test
    fun openingMenuCreatesOneIntrinsicWindowOnTheRight() {
        controller.openMenu(4)

        assertEquals(
            DetachedSurfaceState(DetachedSurfaceMode.MENU, 4, DetachedSurfaceSide.RIGHT, 208, 260),
            controller.activeSurface,
        )
        assertEquals(1, windows.addCount)
        assertEquals(WindowSnapshot(120, 200, 208, 260), windows.added.single())
    }

    @Test
    fun differentModeWithSameGenerationIsRejectedWithoutReplacingActiveWindow() {
        controller.openMenu(4)

        assertFalse(controller.openBubble(4))

        assertEquals(1, windows.addCount)
        assertEquals(0, windows.removeCount)
        assertEquals(1, windows.maximumAttached)
        assertEquals(
            DetachedSurfaceState(DetachedSurfaceMode.MENU, 4, DetachedSurfaceSide.RIGHT, 208, 260),
            controller.activeSurface,
        )
    }

    @Test
    fun newerGenerationCanReplaceActiveModeWithoutOwningTwoWindows() {
        controller.openMenu(4)

        assertTrue(controller.openBubble(5))

        assertEquals(2, windows.addCount)
        assertEquals(1, windows.removeCount)
        assertEquals(1, windows.maximumAttached)
        assertEquals(
            DetachedSurfaceState(DetachedSurfaceMode.BUBBLE, 5, DetachedSurfaceSide.RIGHT, 1, 1),
            controller.activeSurface,
        )
    }

    @Test
    fun sameModeAndGenerationIsIdempotentAndOlderGenerationIsIgnored() {
        controller.openMenu(8)
        controller.openMenu(8)
        controller.openBubble(7)

        assertEquals(1, windows.addCount)
        assertEquals(0, windows.removeCount)
        assertEquals(DetachedSurfaceMode.MENU, controller.activeSurface?.mode)
        assertEquals(8L, controller.activeSurface?.generation)
    }

    @Test
    fun validMatchingMeasurementUpdatesBoundsAndPlacementOnTheLeft() {
        anchor = OverlayPlacement(320, 600, 72, Attachment.Free)
        controller.openBubble(9)

        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 9, 208, 260)

        assertEquals(
            DetachedSurfaceState(DetachedSurfaceMode.BUBBLE, 9, DetachedSurfaceSide.LEFT, 208, 260),
            controller.activeSurface,
        )
        assertEquals(1, windows.updateCount)
        assertEquals(WindowSnapshot(104, 540, 208, 260), windows.updated.single())
    }

    @Test
    fun measurementLayoutFailureDetachesCleansAndEmitsExactlyOneTypedLoss() {
        assertTrue(controller.openBubble(41))
        val failed = webViews.created.single()
        windows.failUpdateCount = 1

        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 41, 208, 260)
        controller.reflow()

        assertNull(controller.activeSurface)
        assertEquals(1, windows.updateAttempts)
        assertEquals(1, windows.removeCount)
        assertTrue(failed.loadingStopped)
        assertTrue(failed.bridgeRemoved)
        assertTrue(failed.destroyed)
        assertEquals(
            listOf(DetachedSurfaceLoss(DetachedSurfaceMode.BUBBLE, 41)),
            losses,
        )
    }

    @Test
    fun reflowLayoutFailureDetachesCleansAndEmitsExactlyOneTypedLoss() {
        assertTrue(controller.openMenu(42))
        val failed = webViews.created.single()
        anchor = OverlayPlacement(320, 600, 72, Attachment.Free)
        windows.failUpdateCount = 1

        controller.reflow()
        controller.reflow()
        controller.destroy()
        controller.destroy()

        assertNull(controller.activeSurface)
        assertEquals(1, windows.updateAttempts)
        assertEquals(1, windows.removeCount)
        assertTrue(failed.destroyed)
        assertEquals(
            listOf(DetachedSurfaceLoss(DetachedSurfaceMode.MENU, 42)),
            losses,
        )
    }

    @Test
    fun staleLayoutFailureCannotCloseOrReportLossForNewerSurface() {
        assertTrue(controller.openMenu(43))
        val oldView = webViews.created.single()
        windows.failUpdateCount = 1
        windows.beforeFailingUpdate = {
            assertTrue(controller.openBubble(44))
        }

        controller.reflow()

        assertEquals(DetachedSurfaceMode.BUBBLE, controller.activeSurface?.mode)
        assertEquals(44L, controller.activeSurface?.generation)
        assertTrue(oldView.destroyed)
        assertFalse(webViews.created.last().destroyed)
        assertTrue(losses.isEmpty())
    }

    @Test
    fun invalidOrStaleMeasurementsNeverReachWindowManager() {
        controller.openBubble(9)

        controller.applyMeasurement(DetachedSurfaceMode.MENU, 9, 100, 100)
        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 8, 100, 100)
        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 9, 0, 100)
        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 9, 100, -1)
        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 9, 601, 100)
        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 9, 100, 601)

        assertEquals(0, windows.updateCount)
        assertEquals(1, controller.activeSurface?.widthDp)
        assertEquals(1, controller.activeSurface?.heightDp)
    }

    @Test
    fun reflowUpdatesOnlyDetachedBounds() {
        controller.openMenu(3)
        anchor = OverlayPlacement(320, 600, 72, Attachment.Free)

        controller.reflow()

        assertEquals(1, windows.addCount)
        assertEquals(1, windows.updateCount)
        assertEquals(0, windows.removeCount)
        assertEquals(WindowSnapshot(104, 540, 208, 260), windows.updated.single())
        assertEquals(DetachedSurfaceSide.LEFT, controller.activeSurface?.side)
    }

    @Test
    fun staleCloseIsIgnoredAndMatchingCloseFullyRemovesSurface() {
        controller.openMenu(5)
        val view = webViews.created.single()

        controller.close(4)
        assertEquals(0, windows.removeCount)

        controller.close(5)
        assertNull(controller.activeSurface)
        assertEquals(1, windows.removeCount)
        assertTrue(view.destroyed)
        assertTrue(view.bridgeRemoved)
    }

    @Test
    fun destroyIsIdempotentAndPreventsFutureWindows() {
        controller.openBubble(2)

        controller.destroy()
        controller.destroy()
        controller.openMenu(3)
        controller.reflow()

        assertNull(controller.activeSurface)
        assertEquals(1, windows.addCount)
        assertEquals(1, windows.removeCount)
        assertEquals(0, windows.updateCount)
    }

    @Test
    fun addViewFailureDoesNotRecordWindowAndCleansCreatedWebViewAndCallbacks() {
        windows.failAddCount = 1

        val opened = controller.openMenu(31)

        assertFalse(opened)
        val failedView = webViews.created.single()
        assertNull(controller.activeSurface)
        assertTrue(failedView.loadingStopped)
        assertTrue(failedView.bridgeRemoved)
        assertTrue(failedView.destroyed)

        failedView.rendererGone?.invoke(failedView)
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(1, webViews.created.size)
        assertNull(controller.activeSurface)
    }

    @Test
    fun factoryFailureReturnsFalseWithoutReplacingValidActiveSurface() {
        assertTrue(controller.openMenu(35))
        val active = controller.activeSurface
        val activeView = webViews.created.single()
        webViews.failCreate = true

        assertFalse(controller.openBubble(36))

        assertSame(active, controller.activeSurface)
        assertFalse(activeView.destroyed)
        assertEquals(1, windows.addCount)
        assertEquals(0, windows.removeCount)
    }

    @Test
    fun replacementAddFailureRestoresValidPriorSurface() {
        assertTrue(controller.openMenu(37))
        val active = controller.activeSurface
        val activeView = webViews.created.single()
        windows.failAddCount = 1

        assertFalse(controller.openBubble(38))

        assertSame(active, controller.activeSurface)
        assertFalse(activeView.destroyed)
        assertEquals(2, windows.addCount)
        assertEquals(2, windows.removeCount)
        assertEquals(1, windows.maximumAttached)
    }

    @Test
    fun removeFailureStillCancelsRecoveryClearsStateAndCleansWebView() {
        controller.openBubble(32)
        val view = webViews.created.single()
        controller.recoverRenderer(view, 32)
        windows.failRemove = true

        controller.close(32)
        shadowOf(Looper.getMainLooper()).idle()

        assertNull(controller.activeSurface)
        assertEquals(1, webViews.created.size)
        assertTrue(view.loadingStopped)
        assertTrue(view.bridgeRemoved)
        assertTrue(view.destroyed)
    }

    @Test
    fun destroyRemainsIdempotentlyDestroyedWhenWindowRemovalThrows() {
        controller.openMenu(33)
        val view = webViews.created.single()
        windows.failRemove = true

        controller.destroy()
        controller.destroy()
        controller.openBubble(34)

        assertNull(controller.activeSurface)
        assertEquals(1, webViews.created.size)
        assertTrue(view.loadingStopped)
        assertTrue(view.bridgeRemoved)
        assertTrue(view.destroyed)
    }

    @Test
    fun repeatedReadySendsStateAndOpenOnlyOnceWithCurrentGeneration() {
        controller.openMenu(11)
        val view = webViews.created.single()

        webViews.message(view, surfaceReady(DetachedSurfaceMode.BUBBLE, 11))
        webViews.message(view, surfaceReady(DetachedSurfaceMode.MENU, 10))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(view.scripts.isEmpty())

        webViews.message(view, surfaceReady(DetachedSurfaceMode.MENU, 11))
        webViews.message(view, surfaceReady(DetachedSurfaceMode.MENU, 11))

        assertTrue(view.scripts.isEmpty())
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(2, view.scripts.size)
        assertTrue(view.scripts[0].contains("\"type\":\"state-changed\""))
        assertTrue(view.scripts[0].contains("\"generation\":11"))
        assertTrue(view.scripts[1].contains("\"type\":\"open-menu\""))
        assertTrue(view.scripts[1].contains("\"generation\":11"))
    }

    @Test
    fun onlyActiveViewModeAndGenerationCanMeasureOrDispatchActions() {
        controller.openMenu(12)
        val oldView = webViews.created.single()
        controller.openBubble(13)
        val activeView = webViews.created.last()

        webViews.message(oldView, surfaceReady(DetachedSurfaceMode.MENU, 12))
        webViews.message(
            oldView,
            DetachedOverlayWebMessage.SurfaceAction(
                DetachedSurfaceMode.MENU,
                12,
                DetachedSurfaceAction.Menu(12, OverlayMenuAction.CLOSE),
            ),
        )
        webViews.message(
            activeView,
            DetachedOverlayWebMessage.SurfaceAction(
                DetachedSurfaceMode.BUBBLE,
                12,
                DetachedSurfaceAction.Reminder(12, "lookAway", OverlayReminderAction.SKIP),
            ),
        )
        webViews.message(
            activeView,
            DetachedOverlayWebMessage.SurfaceAction(
                DetachedSurfaceMode.BUBBLE,
                13,
                DetachedSurfaceAction.Reminder(13, "lookAway", OverlayReminderAction.SKIP),
            ),
        )

        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(
            listOf(DetachedSurfaceAction.Reminder(13, "lookAway", OverlayReminderAction.SKIP)),
            actions,
        )
    }

    @Test
    fun rendererRecoveryRequiresActiveIdentityAndGenerationAndQueuesOnce() {
        controller.openMenu(20)
        val active = webViews.created.single()
        val stranger = RecordingWebView(context)

        controller.recoverRenderer(stranger, 20)
        controller.recoverRenderer(active, 19)
        controller.recoverRenderer(active, 20)
        controller.recoverRenderer(active, 20)
        assertEquals(1, webViews.created.size)

        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(2, webViews.created.size)
        assertEquals(2, windows.addCount)
        assertEquals(1, windows.removeCount)
        assertEquals(1, windows.maximumAttached)
        assertEquals(20L, controller.activeSurface?.generation)
    }

    @Test
    fun rendererRecoveryFactoryFailureEmitsOneGenerationBoundLossWithoutRetryLoop() {
        assertTrue(controller.openMenu(39))
        val failed = webViews.created.single()
        webViews.failCreate = true

        controller.recoverRenderer(failed, 39)
        controller.recoverRenderer(failed, 39)
        shadowOf(Looper.getMainLooper()).idle()

        assertNull(controller.activeSurface)
        assertEquals(
            listOf(DetachedSurfaceLoss(DetachedSurfaceMode.MENU, 39)),
            losses,
        )
        assertEquals(1, webViews.created.size)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, losses.size)
        assertEquals(1, webViews.created.size)
    }

    @Test
    fun rendererRecoveryAddFailureEmitsOneGenerationBoundLoss() {
        assertTrue(controller.openBubble(40))
        val failed = webViews.created.single()
        windows.failAddCount = 1

        controller.recoverRenderer(failed, 40)
        shadowOf(Looper.getMainLooper()).idle()

        assertNull(controller.activeSurface)
        assertEquals(
            listOf(DetachedSurfaceLoss(DetachedSurfaceMode.BUBBLE, 40)),
            losses,
        )
        assertEquals(2, webViews.created.size)
    }

    @Test
    fun closingBeforeQueuedRecoveryCancelsReplacement() {
        controller.openBubble(21)
        val active = webViews.created.single()
        controller.recoverRenderer(active, 21)

        controller.close(21)
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(1, webViews.created.size)
        assertEquals(1, windows.addCount)
        assertEquals(1, windows.removeCount)
        assertNull(controller.activeSurface)
    }

    @Test
    fun recoveredRendererRestoresOnlyCapturedActiveGenerationAfterReady() {
        controller.openBubble(22)
        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 22, 280, 340)
        val failed = webViews.created.single()
        controller.recoverRenderer(failed, 22)
        shadowOf(Looper.getMainLooper()).idle()
        val replacement = webViews.created.last()

        webViews.message(replacement, surfaceReady(DetachedSurfaceMode.BUBBLE, 22))
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(2, replacement.scripts.size)
        assertTrue(replacement.scripts.all { it.contains("\"generation\":22") })
        assertTrue(replacement.scripts.last().contains("\"type\":\"show-reminder\""))
        assertEquals(280, controller.activeSurface?.widthDp)
        assertEquals(340, controller.activeSurface?.heightDp)
    }

    @Test
    fun detachedCallbacksArePostedAndRevalidatedBeforeAnyEffect() {
        controller.openMenu(24)
        val staleView = webViews.created.single()

        webViews.message(staleView, surfaceReady(DetachedSurfaceMode.MENU, 24))
        webViews.message(
            staleView,
            DetachedOverlayWebMessage.SurfaceSizeChanged(DetachedSurfaceMode.MENU, 24, 305, 248),
        )
        webViews.message(
            staleView,
            DetachedOverlayWebMessage.SurfaceAction(
                DetachedSurfaceMode.MENU,
                24,
                DetachedSurfaceAction.Menu(24, OverlayMenuAction.HIDE),
            ),
        )
        controller.openBubble(25)
        val updatesBeforeCallbacks = windows.updateCount
        val addsBeforeCallbacks = windows.addCount
        val removesBeforeCallbacks = windows.removeCount

        shadowOf(Looper.getMainLooper()).idle()

        assertTrue(staleView.scripts.isEmpty())
        assertTrue(actions.isEmpty())
        assertEquals(updatesBeforeCallbacks, windows.updateCount)
        assertEquals(addsBeforeCallbacks, windows.addCount)
        assertEquals(removesBeforeCallbacks, windows.removeCount)
        assertEquals(
            DetachedSurfaceState(DetachedSurfaceMode.BUBBLE, 25, DetachedSurfaceSide.RIGHT, 1, 1),
            controller.activeSurface,
        )
    }

    @Test
    fun validMeasurementLargerThanScreenUsesEffectiveClampedDimensions() {
        screen = Bounds(widthDp = 300, heightDp = 200)
        controller.openBubble(26)

        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 26, 500, 600)

        assertEquals(
            DetachedSurfaceState(DetachedSurfaceMode.BUBBLE, 26, DetachedSurfaceSide.RIGHT, 300, 200),
            controller.activeSurface,
        )
        assertEquals(WindowSnapshot(0, 0, 300, 200), windows.updated.single())
    }

    @Test
    fun bubblePlaceholderIsNotTouchableUntilValidMeasurementIsApplied() {
        controller.openBubble(27)

        assertTrue(
            windows.addedFlags.single() and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE != 0,
        )

        controller.applyMeasurement(DetachedSurfaceMode.BUBBLE, 27, 280, 340)

        assertFalse(
            windows.updatedFlags.single() and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE != 0,
        )
    }

    @Test
    fun petLayoutBytesNeverChangeAndPetLayoutIsNeverPassedToWindowManager() {
        val petLayout = WindowManager.LayoutParams(72, 72, 7, 9, 0)
        val before = bytesOf(petLayout)

        controller.openMenu(30)
        controller.applyMeasurement(DetachedSurfaceMode.MENU, 30, 305, 248)
        controller.reflow()
        controller.close(30)

        assertArrayEquals(before, bytesOf(petLayout))
        assertTrue(windows.receivedParams.all { it !== petLayout })
        windows.receivedParams.forEach { assertNotSame(petLayout, it) }
    }

    @Test
    fun detachedFactoryUrlCarriesStrictEncodedIdentityAndUniquePageInstance() {
        val factory = OverlayWebViewFactory(context, onMessage = {})
        val createDetached = factory.javaClass.methods.singleOrNull { method ->
            method.name == "createDetached" &&
                method.parameterTypes.firstOrNull() == DetachedSurfaceMode::class.java
        }
        assertTrue("createDetached must require mode and generation", createDetached != null)
        val rendererGone: (WebView) -> Unit = {}
        val onMessage: (WebView, DetachedOverlayWebMessage) -> Unit = { _, _ -> }

        val first = requireNotNull(createDetached).invoke(
            factory,
            DetachedSurfaceMode.MENU,
            47L,
            rendererGone,
            onMessage,
        ) as WebView
        val second = createDetached.invoke(
            factory,
            DetachedSurfaceMode.MENU,
            47L,
            rendererGone,
            onMessage,
        ) as WebView
        val firstUrl = requireNotNull(first.url ?: shadowOf(first).lastLoadedUrl)
        val secondUrl = requireNotNull(second.url ?: shadowOf(second).lastLoadedUrl)
        val firstUri = Uri.parse(firstUrl)

        assertEquals("surface", firstUri.getQueryParameter("overlay"))
        assertEquals("MENU", firstUri.getQueryParameter("mode"))
        assertEquals("47", firstUri.getQueryParameter("generation"))
        assertTrue(firstUri.getQueryParameter("instance")?.isNotBlank() == true)
        assertNotEquals(firstUrl, secondUrl)

        first.destroy()
        second.destroy()
    }

    private fun surfaceReady(
        mode: DetachedSurfaceMode,
        generation: Long,
    ): DetachedOverlayWebMessage {
        val type = Class.forName(
            "io.elevenlabs.codexpetpause.overlay.DetachedOverlayWebMessage\$SurfaceReady",
        )
        val constructor = type.declaredConstructors.singleOrNull { it.parameterCount == 2 }
        assertTrue("surface-ready must carry mode and generation", constructor != null)
        return requireNotNull(constructor).newInstance(mode, generation) as DetachedOverlayWebMessage
    }

    private fun bytesOf(params: WindowManager.LayoutParams): ByteArray {
        val parcel = Parcel.obtain()
        return try {
            params.writeToParcel(parcel, 0)
            parcel.marshall()
        } finally {
            parcel.recycle()
        }
    }
}

private data class WindowSnapshot(val x: Int, val y: Int, val width: Int, val height: Int)

private class RecordingWindowManager(private val delegate: WindowManager) : WindowManager by delegate {
    val added = mutableListOf<WindowSnapshot>()
    val updated = mutableListOf<WindowSnapshot>()
    val receivedParams = mutableListOf<ViewGroup.LayoutParams>()
    val addedFlags = mutableListOf<Int>()
    val updatedFlags = mutableListOf<Int>()
    var removeCount = 0
    var attached = 0
    var maximumAttached = 0
    var failAddCount = 0
    var failRemove = false
    var failUpdateCount = 0
    var beforeFailingUpdate: (() -> Unit)? = null
    var updateAttempts = 0
    val addCount get() = added.size
    val updateCount get() = updated.size

    override fun addView(view: View, params: ViewGroup.LayoutParams) {
        if (failAddCount > 0) {
            failAddCount -= 1
            throw IllegalStateException("add failed")
        }
        receivedParams += params
        added += snapshot(params)
        addedFlags += (params as WindowManager.LayoutParams).flags
        attached += 1
        maximumAttached = maxOf(maximumAttached, attached)
    }

    override fun updateViewLayout(view: View, params: ViewGroup.LayoutParams) {
        updateAttempts += 1
        if (failUpdateCount > 0) {
            failUpdateCount -= 1
            beforeFailingUpdate?.invoke()
            throw IllegalStateException("update failed")
        }
        receivedParams += params
        updated += snapshot(params)
        updatedFlags += (params as WindowManager.LayoutParams).flags
    }

    override fun removeViewImmediate(view: View) {
        removeCount += 1
        if (failRemove) throw IllegalStateException("remove failed")
        attached = (attached - 1).coerceAtLeast(0)
    }

    private fun snapshot(params: ViewGroup.LayoutParams): WindowSnapshot {
        params as WindowManager.LayoutParams
        return WindowSnapshot(params.x, params.y, params.width, params.height)
    }
}

private class RecordingDetachedWebViewFactory(private val context: Context) : DetachedWebViewFactory {
    val created = mutableListOf<RecordingWebView>()
    var failCreate = false
    private val callbacks = IdentityHashMap<WebView, (WebView, DetachedOverlayWebMessage) -> Unit>()

    override fun create(
        mode: DetachedSurfaceMode,
        generation: Long,
        onRendererGone: (WebView) -> Unit,
        onMessage: (WebView, DetachedOverlayWebMessage) -> Unit,
    ): WebView {
        if (failCreate) throw IllegalStateException("factory failed")
        return RecordingWebView(context).also {
        created += it
        callbacks[it] = onMessage
        it.rendererGone = onRendererGone
        }
    }

    fun message(view: WebView, message: DetachedOverlayWebMessage) {
        callbacks.getValue(view)(view, message)
    }
}

private class RecordingWebView(context: Context) : WebView(context) {
    val scripts = mutableListOf<String>()
    var destroyed = false
    var bridgeRemoved = false
    var loadingStopped = false
    var rendererGone: ((WebView) -> Unit)? = null

    override fun evaluateJavascript(script: String, resultCallback: ValueCallback<String>?) {
        scripts += script
    }

    override fun removeJavascriptInterface(name: String) {
        bridgeRemoved = true
        super.removeJavascriptInterface(name)
    }

    override fun stopLoading() {
        loadingStopped = true
        super.stopLoading()
    }

    override fun destroy() {
        destroyed = true
        super.destroy()
    }
}
