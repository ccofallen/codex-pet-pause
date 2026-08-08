package io.elevenlabs.codexpetpause.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.WebView
import io.elevenlabs.codexpetpause.MainActivity
import io.elevenlabs.codexpetpause.R
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateStore
import kotlin.math.roundToInt
import org.json.JSONObject

internal interface OverlayWaitScheduler {
    fun scheduleAt(deadlineMs: Long, action: () -> Unit)
    fun cancel()
}

private class HandlerOverlayWaitScheduler(
    private val handler: Handler,
) : OverlayWaitScheduler {
    private var pending: Runnable? = null

    override fun scheduleAt(deadlineMs: Long, action: () -> Unit) {
        cancel()
        val runnable = Runnable(action)
        pending = runnable
        handler.postAtTime(runnable, deadlineMs)
    }

    override fun cancel() {
        pending?.let(handler::removeCallbacks)
        pending = null
    }
}

internal class OverlayGestureDispatcher(
    private val interpreter: OverlayGestureInterpreter,
    private val scheduler: OverlayWaitScheduler,
    private val onResult: (OverlayGestureResult) -> Unit,
) {
    val placement: OverlayPlacement get() = interpreter.placement

    fun consume(sample: MotionEventSample) {
        val result = interpreter.consume(sample)
        if (result != NoOp) onResult(result)
        when {
            sample.action == MotionAction.UP && result == NoOp -> scheduleWait(sample.eventTimeMs + DOUBLE_TAP_WAIT_MS)
            sample.action == MotionAction.CANCEL -> scheduleWait(sample.eventTimeMs + 1)
            result == OpenMenu -> scheduler.cancel()
            result is PlacementChanged || result == Restored -> scheduler.cancel()
        }
    }

    fun cancelWait() = scheduler.cancel()

    private fun scheduleWait(deadlineMs: Long) {
        scheduler.scheduleAt(deadlineMs) {
            val result = interpreter.consume(MotionEventSample.wait(deadlineMs))
            if (result != NoOp) onResult(result)
        }
    }

    companion object {
        private const val DOUBLE_TAP_WAIT_MS = 251L
    }
}

class PetOverlayService : Service() {
    private enum class SurfaceMode { PET, MENU, BUBBLE }

    private lateinit var windowManager: WindowManager
    private lateinit var coordinator: AndroidStateCoordinator
    private lateinit var mainHandler: Handler
    private var webView: WebView? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var dispatcher: OverlayGestureDispatcher? = null
    private var geometry = OverlayGeometry()
    private var screenBounds = Bounds(400, 800)
    private var placement = OverlayPlacement(0, 0, PetSize.MEDIUM.sizeDp, Attachment.Free)
    private var surfaceMode = SurfaceMode.PET
    private var placementDirty = false
    private var snapshotJson: String? = null
    private var density = 1f

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        coordinator = AndroidStateCoordinator(AndroidStateStore(filesDir))
        mainHandler = Handler(Looper.getMainLooper())
        density = resources.displayMetrics.density.coerceAtLeast(1f)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action ?: START) {
            START, SHOW -> {
                startInForeground()
                showOverlay()
            }
            HIDE -> hideOverlay()
            QUIT -> quitService()
            STATE_CHANGED -> refreshState()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        removeAllOverlayViews()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    internal fun createPetLayoutParams(
        widthPx: Int,
        heightPx: Int,
        xPx: Int = 0,
        yPx: Int = 0,
    ) = WindowManager.LayoutParams(
        widthPx,
        heightPx,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = xPx
        y = yPx
        title = "Codex Pet Pause overlay"
    }

    private fun startInForeground() {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("Pet overlay is active")
            .setContentIntent(openApp)
            .setOngoing(true)
            .build()
        startForeground(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Pet overlay",
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    private fun showOverlay() {
        if (webView != null || !Settings.canDrawOverlays(this)) return
        screenBounds = currentScreenBounds()
        loadPlacementFromState()
        surfaceMode = SurfaceMode.PET
        rebuildDispatcher()
        val params = createPetLayoutParams(
            dpToPx(placement.sizeDp),
            dpToPx(placement.sizeDp),
            dpToPx(placement.x),
            dpToPx(placement.y),
        )
        val view = OverlayWebViewFactory(this) { message ->
            mainHandler.post { handleWebMessage(message) }
        }.create()
        view.setOnTouchListener(::onOverlayTouch)
        layoutParams = params
        webView = view
        windowManager.addView(view, params)
    }

    private fun hideOverlay() {
        removeAllOverlayViews()
    }

    private fun quitService() {
        removeAllOverlayViews()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun removeAllOverlayViews() {
        dispatcher?.cancelWait()
        dispatcher = null
        webView?.let { view ->
            if (view.parent != null) runCatching { windowManager.removeViewImmediate(view) }
            view.removeJavascriptInterface("AndroidOverlay")
            view.destroy()
        }
        webView = null
        layoutParams = null
        surfaceMode = SurfaceMode.PET
    }

    private fun refreshState() {
        val oldSize = placement.sizeDp
        snapshotJson = coordinator.loadSnapshot()
        val nextSize = readPetSize(snapshotJson)
        if (nextSize != oldSize) {
            placement = geometry.resizeAroundAnchor(placement, nextSize, screenBounds)
            geometry = OverlayGeometry(defaultSizeDp = nextSize)
            rebuildDispatcher()
            if (surfaceMode == SurfaceMode.PET) updateSurfaceBounds(nextSize, nextSize)
        }
        sendState()
    }

    private fun loadPlacementFromState() {
        snapshotJson = coordinator.loadSnapshot()
        val snapshot = snapshotJson?.let(::JSONObject)
        val overlay = snapshot?.optJSONObject("overlay")
        val size = readPetSize(snapshotJson)
        geometry = OverlayGeometry(defaultSizeDp = size)
        val availableWidth = (screenBounds.right - screenBounds.left - size).coerceAtLeast(0)
        val availableHeight = (screenBounds.bottom - screenBounds.top - size).coerceAtLeast(0)
        val xRatio = overlay?.optDouble("xRatio", 0.82)?.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0) ?: 0.82
        val yRatio = overlay?.optDouble("yRatio", 0.72)?.takeIf(Double::isFinite)?.coerceIn(0.0, 1.0) ?: 0.72
        placement = OverlayPlacement(
            screenBounds.left + (availableWidth * xRatio).roundToInt(),
            screenBounds.top + (availableHeight * yRatio).roundToInt(),
            size,
            Attachment.Free,
        )
    }

    private fun readPetSize(snapshot: String?): Int {
        val setting = runCatching {
            val root = snapshot?.let(::JSONObject) ?: return@runCatching "medium"
            if (root.isNull("settingsJson")) "medium"
            else JSONObject(root.getString("settingsJson")).optString("petSize", "medium")
        }.getOrDefault("medium")
        return when (setting) {
            "small" -> PetSize.SMALL.sizeDp
            "large" -> PetSize.LARGE.sizeDp
            else -> PetSize.MEDIUM.sizeDp
        }
    }

    private fun rebuildDispatcher() {
        dispatcher?.cancelWait()
        dispatcher = OverlayGestureDispatcher(
            OverlayGestureInterpreter(
                bounds = screenBounds,
                geometry = geometry,
                initialPlacement = placement,
            ),
            HandlerOverlayWaitScheduler(mainHandler),
            ::handleGestureResult,
        )
    }

    private fun onOverlayTouch(view: View, event: MotionEvent): Boolean {
        val sample = event.toMotionEventSample()
        dispatcher?.consume(sample)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            if (placementDirty) persistPlacement()
        }
        return surfaceMode == SurfaceMode.PET
    }

    private fun MotionEvent.toMotionEventSample(): MotionEventSample {
        val index = actionIndex.coerceIn(0, pointerCount - 1)
        val pointerId = getPointerId(index)
        val rawX = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) getRawX(index) else rawX
        val rawY = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) getRawY(index) else rawY
        val action = when (actionMasked) {
            MotionEvent.ACTION_DOWN -> MotionAction.DOWN
            MotionEvent.ACTION_POINTER_DOWN -> MotionAction.POINTER_DOWN
            MotionEvent.ACTION_MOVE -> MotionAction.MOVE
            MotionEvent.ACTION_UP -> MotionAction.UP
            MotionEvent.ACTION_POINTER_UP -> MotionAction.POINTER_UP
            MotionEvent.ACTION_CANCEL -> MotionAction.CANCEL
            else -> MotionAction.CANCEL
        }
        return MotionEventSample(action, rawX / density, rawY / density, eventTime, pointerId)
    }

    private fun handleGestureResult(result: OverlayGestureResult) {
        if (surfaceMode != SurfaceMode.PET) return
        when (result) {
            OverlayGestureResult.NoOp -> Unit
            OverlayGestureResult.SingleTap -> sendWebEvent(JSONObject().put("type", "pet-tap"))
            OverlayGestureResult.OpenMenu -> {
                surfaceMode = SurfaceMode.MENU
                updateSurfaceBounds(placement.sizeDp + MENU_WIDTH_DP + SURFACE_GAP_DP, maxOf(placement.sizeDp, MENU_HEIGHT_DP))
                sendWebEvent(JSONObject().put("type", "open-menu").put("side", placementSide()))
            }
            OverlayGestureResult.Restored -> {
                placement = dispatcher?.placement ?: placement
                placementDirty = true
                updateSurfaceBounds(placement.sizeDp, placement.sizeDp)
                sendPlacementChanged()
            }
            is OverlayGestureResult.PlacementChanged -> {
                placement = result.placement
                placementDirty = true
                updateSurfaceBounds(placement.sizeDp, placement.sizeDp)
                sendPlacementChanged()
            }
        }
    }

    private fun handleWebMessage(message: OverlayWebMessage) {
        when (message) {
            OverlayWebMessage.Ready -> sendState()
            is OverlayWebMessage.BubbleSizeChanged -> {
                surfaceMode = SurfaceMode.BUBBLE
                updateSurfaceBounds(message.widthDp, message.heightDp)
            }
            is OverlayWebMessage.MenuAction -> when (message.action) {
                OverlayMenuAction.SETTINGS -> {
                    collapseToPet()
                    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                OverlayMenuAction.HIDE -> hideOverlay()
                OverlayMenuAction.QUIT -> quitService()
            }
        }
    }

    private fun collapseToPet() {
        surfaceMode = SurfaceMode.PET
        rebuildDispatcher()
        updateSurfaceBounds(placement.sizeDp, placement.sizeDp)
    }

    private fun updateSurfaceBounds(widthDp: Int, heightDp: Int) {
        val view = webView ?: return
        val params = layoutParams ?: return
        val safeWidth = widthDp.coerceIn(1, screenBounds.right - screenBounds.left)
        val safeHeight = heightDp.coerceIn(1, screenBounds.bottom - screenBounds.top)
        val expandLeft = placementSide() == "right" && safeWidth > placement.sizeDp
        val expandUp = placement.y + safeHeight > screenBounds.bottom
        params.width = dpToPx(safeWidth)
        params.height = dpToPx(safeHeight)
        params.x = dpToPx(if (expandLeft) placement.x + placement.sizeDp - safeWidth else placement.x)
        params.y = dpToPx(if (expandUp) placement.y + placement.sizeDp - safeHeight else placement.y)
        windowManager.updateViewLayout(view, params)
    }

    private fun persistPlacement() {
        placementDirty = false
        val maxX = (screenBounds.right - screenBounds.left - placement.sizeDp).coerceAtLeast(0)
        val maxY = (screenBounds.bottom - screenBounds.top - placement.sizeDp).coerceAtLeast(0)
        val clampedX = (placement.x - screenBounds.left).coerceIn(0, maxX)
        val clampedY = (placement.y - screenBounds.top).coerceIn(0, maxY)
        val xRatio = if (maxX == 0) 0.0 else clampedX.toDouble() / maxX
        val yRatio = if (maxY == 0) 0.0 else clampedY.toDouble() / maxY
        snapshotJson = coordinator.saveOverlayPlacement(xRatio, yRatio)
    }

    private fun sendState() {
        val snapshot = snapshotJson ?: coordinator.loadSnapshot() ?: return
        snapshotJson = snapshot
        sendWebEvent(JSONObject().put("type", "state-changed").put("snapshot", JSONObject(snapshot)))
    }

    private fun sendPlacementChanged() {
        sendWebEvent(JSONObject()
            .put("type", "placement-changed")
            .put("side", placementSide()))
    }

    private fun sendWebEvent(message: JSONObject) {
        val script = "window.dispatchEvent(new CustomEvent('android-overlay-message',{detail:${message}}));"
        webView?.post { webView?.evaluateJavascript(script, null) }
    }

    private fun placementSide(): String =
        if (placement.x + placement.sizeDp / 2 >= (screenBounds.left + screenBounds.right) / 2) "right" else "left"

    private fun currentScreenBounds(): Bounds {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val metrics = windowManager.currentWindowMetrics
            val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
            )
            val bounds = metrics.bounds
            return runCatching {
                Bounds(
                    widthDp = (bounds.width() / density).roundToInt(),
                    heightDp = (bounds.height() / density).roundToInt(),
                    safeInsets = SafeInsets(
                        left = (insets.left / density).roundToInt(),
                        top = (insets.top / density).roundToInt(),
                        right = (insets.right / density).roundToInt(),
                        bottom = (insets.bottom / density).roundToInt(),
                    ),
                )
            }.getOrElse { fallbackScreenBounds() }
        }
        return fallbackScreenBounds()
    }

    private fun fallbackScreenBounds(): Bounds {
        val metrics = resources.displayMetrics
        return Bounds(
            widthDp = (metrics.widthPixels / density).roundToInt().coerceAtLeast(40),
            heightDp = (metrics.heightPixels / density).roundToInt().coerceAtLeast(40),
        )
    }

    private fun dpToPx(value: Int): Int = (value * density).roundToInt().coerceAtLeast(1)

    companion object {
        const val START = "START"
        const val SHOW = "SHOW"
        const val HIDE = "HIDE"
        const val QUIT = "QUIT"
        const val STATE_CHANGED = "STATE_CHANGED"
        val COMMANDS: Set<String> = setOf(START, SHOW, HIDE, QUIT, STATE_CHANGED)

        private const val NOTIFICATION_CHANNEL_ID = "pet-overlay"
        private const val NOTIFICATION_ID = 5105
        private const val MENU_WIDTH_DP = 136
        private const val MENU_HEIGHT_DP = 132
        private const val SURFACE_GAP_DP = 8
    }
}
