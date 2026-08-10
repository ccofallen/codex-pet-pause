package io.elevenlabs.codexpetpause.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.view.Gravity
import android.view.WindowManager
import android.webkit.WebView
import org.json.JSONObject
import kotlin.math.roundToInt

enum class DetachedSurfaceMode {
    MENU,
    BUBBLE,
}

data class DetachedSurfaceState(
    val mode: DetachedSurfaceMode,
    val generation: Long,
    val side: DetachedSurfaceSide,
    val widthDp: Int,
    val heightDp: Int,
)

data class DetachedSurfaceLoss(
    val mode: DetachedSurfaceMode,
    val generation: Long,
)

enum class DetachedSurfaceWindowPhase {
    ATTACHED,
    LAYOUT_UPDATED,
    REMOVED,
}

data class DetachedSurfaceWindowEvent(
    val phase: DetachedSurfaceWindowPhase,
    val mode: DetachedSurfaceMode,
    val generation: Long,
    val viewIdentity: Int,
    val widthDp: Int,
    val heightDp: Int,
    val widthPx: Int,
    val heightPx: Int,
    val touchable: Boolean,
)

sealed interface DetachedSurfaceAction {
    val generation: Long

    data class Menu(
        override val generation: Long,
        val action: OverlayMenuAction,
    ) : DetachedSurfaceAction

    data class Reminder(
        override val generation: Long,
        val reminderId: String,
        val action: OverlayReminderAction,
        val snoozeMinutes: Int? = null,
    ) : DetachedSurfaceAction
}

fun interface DetachedWebViewFactory {
    fun create(
        mode: DetachedSurfaceMode,
        generation: Long,
        onRendererGone: (WebView) -> Unit,
        onMessage: (WebView, DetachedOverlayWebMessage) -> Unit,
    ): WebView
}

class DetachedOverlaySurfaceController(
    private val context: Context,
    private val windowManager: WindowManager,
    private val handler: Handler,
    private val screenBoundsProvider: () -> Bounds,
    private val anchorProvider: () -> OverlayPlacement,
    private val snapshotProvider: () -> JSONObject?,
    private val webViewFactory: DetachedWebViewFactory,
    private val onAction: (DetachedSurfaceAction) -> Unit,
    private val onSurfaceLost: (DetachedSurfaceLoss) -> Unit = {},
    private val onWindowEvent: (DetachedSurfaceWindowEvent) -> Unit = {},
) {
    private data class ActiveWindow(
        var state: DetachedSurfaceState,
        val view: WebView,
        val layout: WindowManager.LayoutParams,
        var requestedWidthDp: Int,
        var requestedHeightDp: Int,
        var bubbleMeasured: Boolean,
        var ready: Boolean = false,
    )

    private data class EffectiveGeometry(
        val placement: OverlayPlacement,
        val side: DetachedSurfaceSide,
        val widthDp: Int,
        val heightDp: Int,
    )

    private var activeWindow: ActiveWindow? = null
    private var latestGeneration = -1L
    private var pendingRecovery: Runnable? = null
    private var destroyed = false

    val activeSurface: DetachedSurfaceState?
        get() = activeWindow?.state

    fun openMenu(generation: Long): Boolean = open(DetachedSurfaceMode.MENU, generation)

    fun openBubble(generation: Long): Boolean = open(DetachedSurfaceMode.BUBBLE, generation)

    fun applyMeasurement(
        mode: DetachedSurfaceMode,
        generation: Long,
        widthDp: Int,
        heightDp: Int,
    ) {
        if (destroyed || widthDp !in 1..MAX_SURFACE_DP || heightDp !in 1..MAX_SURFACE_DP) return
        val current = activeWindow ?: return
        if (current.state.mode != mode || current.state.generation != generation) return
        if (current.requestedWidthDp == widthDp && current.requestedHeightDp == heightDp &&
            (mode != DetachedSurfaceMode.BUBBLE || current.bubbleMeasured)
        ) return

        current.requestedWidthDp = widthDp
        current.requestedHeightDp = heightDp
        if (mode == DetachedSurfaceMode.BUBBLE) current.bubbleMeasured = true
        updatePlacement(current)
    }

    fun close(expectedGeneration: Long? = null) {
        if (destroyed) return
        val current = activeWindow ?: return
        if (expectedGeneration != null && current.state.generation != expectedGeneration) return
        cancelRecovery()
        if (current.ready) {
            runCatching {
                dispatch(
                    current,
                    JSONObject()
                        .put("type", "close-surface")
                        .put("mode", current.state.mode.name)
                        .put("generation", current.state.generation),
                )
            }
        }
        removeActiveWindow()
    }

    fun reflow() {
        if (destroyed) return
        activeWindow?.let(::updatePlacement)
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        cancelRecovery()
        removeActiveWindow()
    }

    fun recoverRenderer(failedWebView: WebView, generation: Long) {
        if (destroyed || pendingRecovery != null) return
        val failed = activeWindow ?: return
        if (failed.view !== failedWebView || failed.state.generation != generation) return

        lateinit var replacement: Runnable
        replacement = Runnable {
            if (pendingRecovery !== replacement) return@Runnable
            pendingRecovery = null
            val current = activeWindow ?: return@Runnable
            if (destroyed || current.view !== failedWebView || current.state.generation != generation) {
                return@Runnable
            }
            val mode = current.state.mode
            val requestedWidthDp = current.requestedWidthDp
            val requestedHeightDp = current.requestedHeightDp
            val bubbleMeasured = current.bubbleMeasured
            val lost = DetachedSurfaceLoss(mode, generation)
            removeActiveWindow()
            if (!createWindow(mode, generation, requestedWidthDp, requestedHeightDp, bubbleMeasured)) {
                onSurfaceLost(lost)
            }
        }
        pendingRecovery = replacement
        handler.post(replacement)
    }

    private fun open(mode: DetachedSurfaceMode, generation: Long): Boolean {
        if (destroyed || generation < 0L) return false
        val current = activeWindow
        if (current?.state?.mode == mode && current.state.generation == generation) return true
        if (generation <= latestGeneration) return false

        cancelRecovery()
        val (width, height) = when (mode) {
            DetachedSurfaceMode.MENU -> MENU_WIDTH_DP to MENU_HEIGHT_DP
            DetachedSurfaceMode.BUBBLE -> PLACEHOLDER_DP to PLACEHOLDER_DP
        }
        val opened = createWindow(
            mode,
            generation,
            width,
            height,
            bubbleMeasured = mode == DetachedSurfaceMode.MENU,
        )
        if (opened) latestGeneration = maxOf(latestGeneration, generation)
        return opened
    }

    private fun createWindow(
        mode: DetachedSurfaceMode,
        generation: Long,
        requestedWidthDp: Int,
        requestedHeightDp: Int,
        bubbleMeasured: Boolean,
    ): Boolean {
        if (destroyed) return false
        val view = runCatching {
            webViewFactory.create(
                mode = mode,
                generation = generation,
                onRendererGone = { failed ->
                    handler.post { recoverRenderer(failed, generation) }
                },
                onMessage = { sender, message ->
                    handler.post { handleMessage(sender, generation, message) }
                },
            )
        }.getOrElse { return false }
        val geometry = effectiveGeometry(requestedWidthDp, requestedHeightDp)
        val state = DetachedSurfaceState(
            mode,
            generation,
            geometry.side,
            geometry.widthDp,
            geometry.heightDp,
        )
        val layout = createLayout(
            geometry,
            touchable = mode != DetachedSurfaceMode.BUBBLE || bubbleMeasured,
        )
        val window = ActiveWindow(
            state,
            view,
            layout,
            requestedWidthDp,
            requestedHeightDp,
            bubbleMeasured,
        )
        val previous = activeWindow
        if (previous != null) {
            activeWindow = null
            val removed = runCatching { windowManager.removeViewImmediate(previous.view) }.isSuccess
            if (!removed) {
                cleanupWebView(previous.view)
                cleanupWebView(view)
                return false
            }
            publishWindowEvent(DetachedSurfaceWindowPhase.REMOVED, previous)
        }
        try {
            windowManager.addView(view, layout)
        } catch (_: Throwable) {
            runCatching { windowManager.removeViewImmediate(view) }
            cleanupWebView(view)
            if (previous != null) {
                val restored = runCatching {
                    windowManager.addView(previous.view, previous.layout)
                }.isSuccess
                if (restored) activeWindow = previous else cleanupWebView(previous.view)
            }
            return false
        }
        activeWindow = window
        publishWindowEvent(DetachedSurfaceWindowPhase.ATTACHED, window)
        previous?.let { cleanupWebView(it.view) }
        return true
    }

    private fun handleMessage(sender: WebView, capturedGeneration: Long, message: DetachedOverlayWebMessage) {
        val current = activeWindow ?: return
        if (current.view !== sender || current.state.generation != capturedGeneration) return
        when (message) {
            is DetachedOverlayWebMessage.SurfaceReady -> {
                if (message.mode == current.state.mode && message.generation == current.state.generation) {
                    handleReady(current)
                }
            }
            is DetachedOverlayWebMessage.SurfaceSizeChanged -> applyMeasurement(
                message.mode,
                message.generation,
                message.widthDp,
                message.heightDp,
            )
            is DetachedOverlayWebMessage.SurfaceAction -> {
                if (message.mode == current.state.mode &&
                    message.generation == current.state.generation &&
                    message.action.generation == current.state.generation
                ) {
                    onAction(message.action)
                }
            }
        }
    }

    private fun handleReady(current: ActiveWindow) {
        if (current.ready || activeWindow !== current) return
        current.ready = true
        snapshotProvider()?.let { snapshot ->
            dispatch(
                current,
                JSONObject()
                    .put("type", "state-changed")
                    .put("snapshot", snapshot)
                    .put("generation", current.state.generation),
            )
        }
        val type = when (current.state.mode) {
            DetachedSurfaceMode.MENU -> "open-menu"
            DetachedSurfaceMode.BUBBLE -> "show-reminder"
        }
        dispatch(
            current,
            JSONObject()
                .put("type", type)
                .put("mode", current.state.mode.name)
                .put("side", current.state.side.name.lowercase())
                .put("generation", current.state.generation),
        )
    }

    private fun updatePlacement(current: ActiveWindow) {
        if (activeWindow !== current) return
        val geometry = effectiveGeometry(current.requestedWidthDp, current.requestedHeightDp)
        current.state = current.state.copy(
            side = geometry.side,
            widthDp = geometry.widthDp,
            heightDp = geometry.heightDp,
        )
        applyLayout(
            current.layout,
            geometry,
            touchable = current.state.mode != DetachedSurfaceMode.BUBBLE || current.bubbleMeasured,
        )
        try {
            windowManager.updateViewLayout(current.view, current.layout)
            publishWindowEvent(DetachedSurfaceWindowPhase.LAYOUT_UPDATED, current)
        } catch (_: Throwable) {
            handleLayoutFailure(current)
        }
    }

    private fun handleLayoutFailure(failed: ActiveWindow) {
        if (activeWindow !== failed) return
        val loss = DetachedSurfaceLoss(failed.state.mode, failed.state.generation)
        cancelRecovery()
        activeWindow = null
        runCatching { windowManager.removeViewImmediate(failed.view) }
        publishWindowEvent(DetachedSurfaceWindowPhase.REMOVED, failed)
        cleanupWebView(failed.view)
        runCatching { onSurfaceLost(loss) }
    }

    private fun effectiveGeometry(widthDp: Int, heightDp: Int): EffectiveGeometry {
        val anchor = anchorProvider()
        val screen = screenBoundsProvider()
        val effectiveWidthDp = widthDp.coerceAtMost(screen.right - screen.left)
        val effectiveHeightDp = heightDp.coerceAtMost(screen.bottom - screen.top)
        return EffectiveGeometry(
            placement = DetachedSurfaceGeometry.place(
                anchor,
                DetachedSurfaceSize(effectiveWidthDp, effectiveHeightDp),
                screen,
            ),
            side = sideFor(anchor, screen),
            widthDp = effectiveWidthDp,
            heightDp = effectiveHeightDp,
        )
    }

    private fun sideFor(anchor: OverlayPlacement, screen: Bounds): DetachedSurfaceSide =
        if (anchor.x + anchor.sizeDp / 2f > screen.widthDp / 2f) {
            DetachedSurfaceSide.LEFT
        } else {
            DetachedSurfaceSide.RIGHT
        }

    private fun createLayout(
        geometry: EffectiveGeometry,
        touchable: Boolean,
    ): WindowManager.LayoutParams = WindowManager.LayoutParams(
        dpToPx(geometry.widthDp),
        dpToPx(geometry.heightDp),
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = dpToPx(geometry.placement.x)
        y = dpToPx(geometry.placement.y)
    }

    private fun applyLayout(
        layout: WindowManager.LayoutParams,
        geometry: EffectiveGeometry,
        touchable: Boolean,
    ) {
        layout.width = dpToPx(geometry.widthDp)
        layout.height = dpToPx(geometry.heightDp)
        layout.x = dpToPx(geometry.placement.x)
        layout.y = dpToPx(geometry.placement.y)
        layout.flags = if (touchable) {
            layout.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
        } else {
            layout.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        }
    }

    private fun dispatch(current: ActiveWindow, message: JSONObject) {
        if (activeWindow !== current) return
        val script = "window.dispatchEvent(new CustomEvent('android-overlay-message',{detail:$message}));"
        current.view.evaluateJavascript(script, null)
    }

    private fun removeActiveWindow() {
        cancelRecovery()
        val current = activeWindow ?: return
        activeWindow = null
        runCatching { windowManager.removeViewImmediate(current.view) }
        publishWindowEvent(DetachedSurfaceWindowPhase.REMOVED, current)
        cleanupWebView(current.view)
    }

    private fun publishWindowEvent(
        phase: DetachedSurfaceWindowPhase,
        window: ActiveWindow,
    ) {
        onWindowEvent(
            DetachedSurfaceWindowEvent(
                phase = phase,
                mode = window.state.mode,
                generation = window.state.generation,
                viewIdentity = System.identityHashCode(window.view),
                widthDp = window.state.widthDp,
                heightDp = window.state.heightDp,
                widthPx = window.layout.width,
                heightPx = window.layout.height,
                touchable = window.layout.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0,
            ),
        )
    }

    private fun cleanupWebView(view: WebView) {
        runCatching { view.removeJavascriptInterface(OverlayWebViewFactory.BRIDGE_NAME) }
        runCatching { view.stopLoading() }
        runCatching { view.destroy() }
    }

    private fun cancelRecovery() {
        pendingRecovery?.let(handler::removeCallbacks)
        pendingRecovery = null
    }

    private fun dpToPx(dp: Int): Int = (dp * context.resources.displayMetrics.density).roundToInt()

    private companion object {
        const val MENU_WIDTH_DP = 208
        const val MENU_HEIGHT_DP = 260
        const val PLACEHOLDER_DP = 1
        const val MAX_SURFACE_DP = 600
    }
}
