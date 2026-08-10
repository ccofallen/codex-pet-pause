package io.elevenlabs.codexpetpause.overlay

import android.app.Notification
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.Rect
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
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
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.reminders.CloseBubble
import io.elevenlabs.codexpetpause.reminders.CoroutineReminderLiveTimer
import io.elevenlabs.codexpetpause.reminders.ReminderDeliveryScheduler
import io.elevenlabs.codexpetpause.reminders.ReminderEngine
import io.elevenlabs.codexpetpause.reminders.JobSchedulerReminderRecovery
import io.elevenlabs.codexpetpause.reminders.ReminderNotificationFactory
import io.elevenlabs.codexpetpause.reminders.ReminderQueueNotificationDispatcher
import io.elevenlabs.codexpetpause.reminders.ReminderTransition
import io.elevenlabs.codexpetpause.reminders.ShowReminder
import io.elevenlabs.codexpetpause.reminders.SystemReminderClock
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.json.JSONObject

internal fun overlayRendererSnapshot(snapshotJson: String): String {
    val snapshot = JSONObject(snapshotJson)
    snapshot.put("historyJson", org.json.JSONArray())
    snapshot.put("pets", org.json.JSONArray())
    snapshot.optJSONObject("overlay")
        ?.optJSONObject("activePet")
        ?.remove("spritesheetBase64")
    return snapshot.toString()
}

internal fun shouldRecreateOverlayAfterRendererLoss(
    petVisible: Boolean,
    overlayGranted: Boolean,
): Boolean = petVisible && overlayGranted

internal interface OverlayWaitScheduler {
    fun scheduleAt(deadlineMs: Long, action: () -> Unit)
    fun cancel()
}

internal enum class OverlayTapAction { PET_INTERACTION, OPEN_REMINDER }

internal fun overlayTapAction(hasPendingReminder: Boolean): OverlayTapAction =
    if (hasPendingReminder) OverlayTapAction.OPEN_REMINDER else OverlayTapAction.PET_INTERACTION

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
            sample.action == MotionAction.UP && result == NoOp ->
                scheduleWait(sample.eventTimeMs + interpreter.doubleTapWindowMs)
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
}

open class PetOverlayService : Service() {
    private data class ReminderReconciliationOutcome(
        val succeeded: Boolean,
        val pendingReminderKnown: Boolean,
    )

    private data class OverlayRendererSurface(
        val mode: SurfaceMode,
        val generation: Long,
    )

    private var unsubscribeStateRefresh: (() -> Unit)? = null
    private enum class SurfaceMode { PET, MENU, BUBBLE }

    private lateinit var windowManager: WindowManager
    private lateinit var coordinator: AndroidStateCoordinator
    private lateinit var mainHandler: Handler
    private lateinit var displayManager: DisplayManager
    private lateinit var reminderEngine: ReminderEngine
    private lateinit var reminderClock: io.elevenlabs.codexpetpause.reminders.ReminderClock
    private lateinit var reminderDelivery: ReminderDeliveryScheduler
    private lateinit var reminderNotifications: ReminderNotificationFactory
    private lateinit var lifecycle: AndroidServiceLifecycle
    private lateinit var detachedSurfaceController: DetachedOverlaySurfaceController
    private var debugControls: PetOverlayDebugControls? = null
    private val reminderScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var webView: WebView? = null
    internal var currentOverlayWebViewFactory: OverlayWebViewFactory? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var dispatcher: OverlayGestureDispatcher? = null
    private var geometry = OverlayGeometry()
    private var screenBounds = Bounds(400, 800)
    private var placement = OverlayPlacement(0, 0, PetSize.MEDIUM.sizeDp, Attachment.Free)
    private var surfaceMode = SurfaceMode.PET
    private var surfaceGeneration = 0L
    private var dragInteractionActive = false
    private var lastTouchX = 0f
    private val webEventGate = OverlayWebEventGate<JSONObject>()
    private var pendingSurfaceEvent: JSONObject? = null
    private var surfaceRetryIndex = 0
    private val surfaceRetryRunnable = object : Runnable {
        override fun run() {
            val event = pendingSurfaceEvent ?: return
            if (surfaceRetryIndex >= SURFACE_RETRY_DELAYS_MS.size) return
            sendWebEvent(event)
            mainHandler.postDelayed(this, SURFACE_RETRY_DELAYS_MS[surfaceRetryIndex++])
        }
    }
    private var placementDirty = false
    private var snapshotJson: String? = null
    private var density = 1f
    private var reminderReconciled = false
    private var overlayWebViewGeneration = 0L
    private var overlayRendererRecoveryRunnable: Runnable? = null
    private var pendingRendererSurface: OverlayRendererSurface? = null
    private var overlayRendererRecreationScheduled = false
    private val overlayRendererRecreationRunnable = Runnable {
        overlayRendererRecreationScheduled = false
        val state = lifecycle.snapshot()
        if (webView == null && shouldRecreateOverlayAfterRendererLoss(
                petVisible = state.petVisible,
                overlayGranted = hasOverlayPermission(),
            )
        ) {
            showOverlay()
        } else {
            pendingRendererSurface = null
        }
    }
    private val displayReflowRunnable = Runnable(::reflowOverlayForCurrentDisplay)
    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = scheduleDisplayReflow()
        override fun onDisplayRemoved(displayId: Int) = scheduleDisplayReflow()
        override fun onDisplayChanged(displayId: Int) = scheduleDisplayReflow()
    }

    override fun onCreate() {
        super.onCreate()
        unsubscribeStateRefresh = PetOverlayStateRefreshBus.subscribe {
            Handler(Looper.getMainLooper()).post { refreshState() }
        }
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        coordinator = AndroidStateCoordinatorRegistry.forFilesDir(filesDir)
        mainHandler = Handler(Looper.getMainLooper())
        displayManager = getSystemService(DisplayManager::class.java)
        displayManager.registerDisplayListener(displayListener, mainHandler)
        debugControls = if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            PetOverlayDebugHooks.current()
        } else {
            null
        }
        reminderClock = debugControls ?: SystemReminderClock
        reminderEngine = ReminderEngine(coordinator, reminderClock)
        reminderDelivery = ReminderDeliveryScheduler(
            reminderEngine,
            reminderClock,
            debugControls?.liveTimer ?: CoroutineReminderLiveTimer(reminderScope),
            debugControls?.recoveryScheduler ?: JobSchedulerReminderRecovery(this),
        )
        reminderNotifications = ReminderNotificationFactory(this)
        lifecycle = AndroidServiceLifecycle.forContext(this)
        density = resources.displayMetrics.density.coerceAtLeast(1f)
        val detachedWebViews = OverlayWebViewFactory(context = this, onMessage = {})
        detachedSurfaceController = DetachedOverlaySurfaceController(
            context = this,
            windowManager = windowManager,
            handler = mainHandler,
            screenBoundsProvider = { screenBounds },
            anchorProvider = { placement },
            snapshotProvider = {
                val snapshot = snapshotJson ?: coordinator.loadSnapshot() ?: return@DetachedOverlaySurfaceController null
                snapshotJson = snapshot
                JSONObject(overlayRendererSnapshot(snapshot))
            },
            webViewFactory = DetachedWebViewFactory { mode, generation, onRendererGone, onMessage ->
                detachedWebViews.createDetached(mode, generation, onRendererGone, onMessage)
            },
            onAction = ::handleDetachedSurfaceAction,
            onSurfaceLost = ::handleDetachedSurfaceLost,
            onWindowEvent = { event -> debugControls?.recordDetachedSurfaceWindowEvent(event) },
        )
        createNotificationChannel()
        reminderNotifications.ensureChannels()
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            activeDebugInstance = this
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        scheduleDisplayReflow()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        val action = intent?.action
        if (action == QUIT) {
            quitService()
            return START_NOT_STICKY
        }
        if (!lifecycle.snapshot().recoveryAllowed) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val state = when (action) {
            null -> lifecycle.snapshot()
            START -> lifecycle.start()
            SHOW, OPEN_REMINDER -> lifecycle.show()
            HIDE -> lifecycle.hide()
            else -> lifecycle.snapshot()
        }
        if (!state.serviceActive || !state.recoveryAllowed) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (state.petVisible && hasOverlayPermission()) showOverlay() else hideOverlay()
        when (action ?: START) {
            START, SHOW, HIDE -> {
                reconcileReminders()
            }
            STATE_CHANGED -> {
                refreshState()
                reconcileReminders()
            }
            OPEN_REMINDER -> {
                reconcileReminders()
                openReminderBubble()
            }
            SNOOZE_CURRENT -> {
                reminderEngine.pendingQueue().firstOrNull()?.let { id ->
                    handleReminderTransition(reminderEngine.snooze(id, reminderClock.now() + 10 * 60_000L))
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        try {
            unsubscribeStateRefresh?.invoke()
            unsubscribeStateRefresh = null
            displayManager.unregisterDisplayListener(displayListener)
            mainHandler.removeCallbacks(displayReflowRunnable)
            cancelOverlayRendererRecreation()
            reminderDelivery.stopLiveTimer()
            reminderScope.cancel()
            runCatching { detachedSurfaceController.destroy() }
            removeAllOverlayViews()
            stopForeground(STOP_FOREGROUND_REMOVE)
        } finally {
            try {
                super.onDestroy()
            } finally {
                if (activeDebugInstance === this) activeDebugInstance = null
            }
        }
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
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        x = xPx
        y = yPx
    }

    private fun startInForeground() {
        startForeground(NOTIFICATION_ID, buildForegroundNotification())
    }

    internal fun buildForegroundNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val showPet = PendingIntent.getForegroundService(
            this,
            SHOW_REQUEST,
            Intent(this, PetOverlayService::class.java).setAction(SHOW),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val openSettings = PendingIntent.getActivity(
            this,
            SETTINGS_REQUEST,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val quit = PendingIntent.getForegroundService(
            this,
            QUIT_REQUEST,
            Intent(this, PetOverlayService::class.java).setAction(QUIT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.overlay_notification_text))
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, getString(R.string.overlay_action_show), showPet).build())
            .addAction(Notification.Action.Builder(null, getString(R.string.overlay_action_settings), openSettings).build())
            .addAction(Notification.Action.Builder(null, getString(R.string.overlay_action_quit), quit).build())
            .build()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.overlay_notification_channel),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    private fun showOverlay() {
        if (webView != null || !hasOverlayPermission()) return
        webEventGate.reset()
        screenBounds = currentScreenBounds()
        loadPlacementFromState()
        surfaceMode = when (detachedSurfaceController.activeSurface?.mode) {
            DetachedSurfaceMode.MENU -> SurfaceMode.MENU
            DetachedSurfaceMode.BUBBLE -> SurfaceMode.BUBBLE
            null -> SurfaceMode.PET
        }
        rebuildDispatcher()
        val params = createPetLayoutParams(
            dpToPx(placement.sizeDp),
            dpToPx(placement.sizeDp),
            dpToPx(placement.x),
            dpToPx(placement.y),
        )
        val viewGeneration = ++overlayWebViewGeneration
        val factory = OverlayWebViewFactory(
            context = this,
            onMessage = { message -> mainHandler.post { handleWebMessage(message) } },
            onRendererGone = { failedView -> scheduleOverlayRendererRecovery(failedView, viewGeneration) },
        )
        currentOverlayWebViewFactory = factory
        val view = factory.create()
        view.setOnTouchListener(::onOverlayTouch)
        layoutParams = params
        webView = view
        windowManager.addView(view, params)
        debugControls?.recordPetLayoutMutation("add-show", view, params)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            view.post {
                if (view.parent != null) {
                    view.systemGestureExclusionRects = listOf(Rect(0, 0, view.width, view.height))
                }
            }
        }
    }

    private fun hideOverlay() {
        cancelOverlayRendererRecreation()
        removeAllOverlayViews()
    }

    private fun quitService() {
        cancelOverlayRendererRecreation()
        lifecycle.quit()
        reminderDelivery.cancelAll()
        reminderNotifications.cancel()
        removeAllOverlayViews()
        stopForeground(STOP_FOREGROUND_REMOVE)
        finishAndRemoveAppTasks(this)
        stopSelf()
    }

    private fun removeAllOverlayViews() {
        if (::detachedSurfaceController.isInitialized) runCatching { detachedSurfaceController.close() }
        removePetOverlayView()
        surfaceMode = SurfaceMode.PET
    }

    private fun removePetOverlayView() {
        cancelSurfaceRetry()
        webEventGate.reset()
        dispatcher?.cancelWait()
        dispatcher = null
        webView?.let { view ->
            if (view.parent != null) {
                layoutParams?.let { debugControls?.recordPetLayoutMutation("hide-remove", view, it) }
                runCatching { windowManager.removeViewImmediate(view) }
            }
            view.removeJavascriptInterface("AndroidOverlay")
            view.destroy()
        }
        webView = null
        currentOverlayWebViewFactory = null
        layoutParams = null
    }

    internal fun scheduleOverlayRendererRecovery(failedView: WebView, failedGeneration: Long): Boolean {
        if (failedView !== webView || failedGeneration != overlayWebViewGeneration) return false
        if (overlayRendererRecoveryRunnable != null) return true
        lateinit var recovery: Runnable
        recovery = Runnable {
            if (overlayRendererRecoveryRunnable !== recovery) return@Runnable
            overlayRendererRecoveryRunnable = null
            recoverFromOverlayRendererLoss(failedView, failedGeneration)
        }
        overlayRendererRecoveryRunnable = recovery
        mainHandler.post(recovery)
        return true
    }

    private fun recoverFromOverlayRendererLoss(failedView: WebView, failedGeneration: Long) {
        if (failedView !== webView || failedGeneration != overlayWebViewGeneration) return
        pendingRendererSurface = OverlayRendererSurface(surfaceMode, surfaceGeneration)
        removePetOverlayView()
        val state = lifecycle.snapshot()
        if (!shouldRecreateOverlayAfterRendererLoss(
                petVisible = state.petVisible,
                overlayGranted = hasOverlayPermission(),
            ) || overlayRendererRecreationScheduled
        ) {
            return
        }
        overlayRendererRecreationScheduled = true
        mainHandler.post(overlayRendererRecreationRunnable)
    }

    private fun restoreRendererSurfaceIfNeeded() {
        val surface = pendingRendererSurface ?: return
        pendingRendererSurface = null
        if (!lifecycle.snapshot().petVisible) return
        when (surface.mode) {
            SurfaceMode.PET -> {
                surfaceMode = SurfaceMode.PET
                surfaceGeneration = surface.generation
            }
            SurfaceMode.MENU -> commitDetachedOpen(
                SurfaceMode.MENU,
                surface.generation,
                detachedSurfaceController.openMenu(surface.generation),
            )
            SurfaceMode.BUBBLE -> if (reminderEngine.pendingQueue().isNotEmpty()) {
                commitDetachedOpen(
                    SurfaceMode.BUBBLE,
                    surface.generation,
                    detachedSurfaceController.openBubble(surface.generation),
                )
            } else {
                surfaceMode = SurfaceMode.PET
                rebuildDispatcher()
                detachedSurfaceController.close()
            }
        }
    }

    private fun cancelOverlayRendererRecreation() {
        if (!::mainHandler.isInitialized) return
        overlayRendererRecoveryRunnable?.let(mainHandler::removeCallbacks)
        overlayRendererRecoveryRunnable = null
        mainHandler.removeCallbacks(overlayRendererRecreationRunnable)
        overlayRendererRecreationScheduled = false
        pendingRendererSurface = null
    }

    protected open fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(this)

    private fun scheduleDisplayReflow() {
        if (!::mainHandler.isInitialized) return
        mainHandler.removeCallbacks(displayReflowRunnable)
        mainHandler.post(displayReflowRunnable)
    }

    private fun reflowOverlayForCurrentDisplay() {
        if (webView == null) return
        val params = layoutParams ?: return
        val previousDensity = density
        val previousBounds = screenBounds
        density = resources.displayMetrics.density.coerceAtLeast(1f)
        val currentBounds = currentScreenBounds()
        if (currentBounds == previousBounds && density == previousDensity) return

        placement = geometry.reflowForBounds(placement, previousBounds, currentBounds)
        screenBounds = currentBounds
        rebuildDispatcher()
        updatePetBounds()
        detachedSurfaceController.reflow()
        sendPlacementChanged()
    }

    private fun refreshState() {
        val oldSize = placement.sizeDp
        snapshotJson = coordinator.loadSnapshot()
        val nextSize = readPetSize(snapshotJson)
        if (nextSize != oldSize) {
            placement = geometry.resizeAroundAnchor(placement, nextSize, screenBounds)
            geometry = OverlayGeometry(defaultSizeDp = nextSize)
            rebuildDispatcher()
            updatePetBounds()
            detachedSurfaceController.reflow()
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
        if (surfaceMode == SurfaceMode.MENU) {
            if (event.actionMasked == MotionEvent.ACTION_UP) closeOverlayMenu()
            return true
        }
        if (surfaceMode != SurfaceMode.PET) return false
        val sample = event.toMotionEventSample()
        val before = placement
        dispatcher?.consume(sample)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> lastTouchX = sample.x
            MotionEvent.ACTION_MOVE -> if (placement != before) {
                val facing = if (sample.x < lastTouchX) "left" else "right"
                val type = if (dragInteractionActive) "pet-drag-move" else "pet-drag-start"
                dragInteractionActive = true
                sendWebEvent(JSONObject().put("type", type).put("facing", facing))
                lastTouchX = sample.x
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (dragInteractionActive) {
                dragInteractionActive = false
                sendWebEvent(JSONObject().put("type", "pet-drag-end"))
            }
        }
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            if (placementDirty) persistPlacement()
        }
        return true
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
            OverlayGestureResult.SingleTap -> handlePetSingleTap()
            OverlayGestureResult.OpenMenu -> {
                val generation = surfaceGeneration + 1
                commitDetachedOpen(
                    SurfaceMode.MENU,
                    generation,
                    detachedSurfaceController.openMenu(generation),
                )
            }
            OverlayGestureResult.Restored -> {
                placement = dispatcher?.placement ?: placement
                placementDirty = true
                updatePetBounds()
                sendPlacementChanged()
            }
            is OverlayGestureResult.PlacementChanged -> {
                placement = result.placement
                placementDirty = true
                updatePetPosition()
                sendPlacementChanged()
            }
        }
    }

    internal fun handleWebMessage(message: OverlayWebMessage) {
        when (message) {
            OverlayWebMessage.Ready -> webEventGate.markReady(
                {
                    sendState()
                    restoreRendererSurfaceIfNeeded()
                },
                ::dispatchWebEvent,
            )
            is OverlayWebMessage.SurfaceRendered -> acknowledgeSurface(message.mode, message.generation)
            is OverlayWebMessage.BubbleSizeChanged -> Unit
            is OverlayWebMessage.MenuAction -> Unit
            is OverlayWebMessage.ReminderAction -> Unit
        }
    }

    internal fun handlePetSingleTap(): OverlayTapAction? {
        val reconciliation = reconcileReminders()
        val action = when {
            reconciliation.pendingReminderKnown -> OverlayTapAction.OPEN_REMINDER
            reconciliation.succeeded -> OverlayTapAction.PET_INTERACTION
            else -> null
        }
        when (action) {
            OverlayTapAction.PET_INTERACTION -> sendWebEvent(JSONObject().put("type", "pet-tap"))
            OverlayTapAction.OPEN_REMINDER -> openReminderBubble()
            null -> Unit
        }
        return action
    }

    private fun handleDetachedSurfaceAction(action: DetachedSurfaceAction) {
        val active = detachedSurfaceController.activeSurface ?: return
        if (action.generation != active.generation) return
        when (action) {
            is DetachedSurfaceAction.Menu -> if (active.mode == DetachedSurfaceMode.MENU) {
                handleMenuAction(action.action)
            }
            is DetachedSurfaceAction.Reminder -> if (active.mode == DetachedSurfaceMode.BUBBLE) {
                handleReminderAction(action.reminderId, action.action, action.snoozeMinutes)
            }
        }
    }

    internal fun dispatchDebugDetachedSurfaceAction(action: DetachedSurfaceAction): Boolean {
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0 || activeDebugInstance !== this) {
            return false
        }
        val active = detachedSurfaceController.activeSurface ?: return false
        if (action.generation != active.generation) return false
        handleDetachedSurfaceAction(action)
        return true
    }

    internal fun handleDetachedSurfaceLost(loss: DetachedSurfaceLoss) {
        val expectedMode = when (loss.mode) {
            DetachedSurfaceMode.MENU -> SurfaceMode.MENU
            DetachedSurfaceMode.BUBBLE -> SurfaceMode.BUBBLE
        }
        if (surfaceMode != expectedMode || surfaceGeneration != loss.generation) return
        if (detachedSurfaceController.activeSurface != null) return
        surfaceMode = SurfaceMode.PET
        rebuildDispatcher()
    }

    private fun handleMenuAction(action: OverlayMenuAction) {
        when (action) {
            OverlayMenuAction.CLOSE -> closeOverlayMenu()
            OverlayMenuAction.SETTINGS -> {
                closeOverlayMenu()
                startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            OverlayMenuAction.HIDE -> {
                lifecycle.hide()
                AndroidCapabilitiesChangedBus.publish()
                hideOverlay()
            }
            OverlayMenuAction.QUIT -> quitService()
        }
    }

    private fun handleReminderAction(
        reminderId: String,
        action: OverlayReminderAction,
        snoozeMinutes: Int?,
    ) {
        val transition = runCatching {
            when (action) {
                OverlayReminderAction.COMPLETE -> reminderEngine.complete(reminderId)
                OverlayReminderAction.SKIP -> reminderEngine.skip(reminderId)
                OverlayReminderAction.SNOOZE -> reminderEngine.snooze(
                    reminderId,
                    reminderClock.now() + requireNotNull(snoozeMinutes) * 60_000L,
                )
            }
        }.getOrElse {
            snapshotJson = coordinator.loadSnapshot()
            sendState()
            return
        }
        handleReminderTransition(transition)
    }

    private fun reconcileReminders(): ReminderReconciliationOutcome {
        val queueBefore = runCatching { reminderEngine.pendingQueue() }.getOrNull()
        val transition = runCatching { reconcileReminderEngine() }.getOrElse {
            reminderDelivery.reschedule { reconcileReminders() }
            return ReminderReconciliationOutcome(
                succeeded = false,
                pendingReminderKnown = queueBefore?.isNotEmpty() == true,
            )
        }
        val queueAfter = runCatching { reminderEngine.pendingQueue() }.getOrElse {
            reminderDelivery.reschedule { reconcileReminders() }
            return ReminderReconciliationOutcome(
                succeeded = false,
                pendingReminderKnown = queueBefore?.isNotEmpty() == true,
            )
        }
        snapshotJson = coordinator.loadSnapshot()
        val shouldNotify = queueAfter.isNotEmpty() && (!reminderReconciled || queueBefore.isNullOrEmpty())
        reminderReconciled = true
        if (shouldNotify) {
            snapshotJson?.let {
                ReminderQueueNotificationDispatcher(reminderNotifications).show(it, queueAfter.first())
            }
        }
        reminderDelivery.reschedule { reconcileReminders() }
        sendState()
        if (transition == CloseBubble && surfaceMode == SurfaceMode.BUBBLE) closeReminderBubble()
        return ReminderReconciliationOutcome(
            succeeded = true,
            pendingReminderKnown = queueAfter.isNotEmpty(),
        )
    }

    internal open fun reconcileReminderEngine(): ReminderTransition = reminderEngine.reconcile()

    private fun handleReminderTransition(transition: io.elevenlabs.codexpetpause.reminders.ReminderTransition) {
        snapshotJson = coordinator.loadSnapshot()
        reminderDelivery.reschedule { reconcileReminders() }
        sendState()
        when (transition) {
            is ShowReminder -> {
                snapshotJson?.let {
                    ReminderQueueNotificationDispatcher(reminderNotifications).show(it, transition.reminderId)
                }
                openReminderBubble()
            }
            CloseBubble -> closeReminderBubble()
        }
    }

    private fun openReminderBubble() {
        if (reminderEngine.pendingQueue().isEmpty()) return
        if (!lifecycle.snapshot().petVisible) return
        showOverlay()
        if (webView == null) return
        val generation = surfaceGeneration + 1
        sendState()
        commitDetachedOpen(
            SurfaceMode.BUBBLE,
            generation,
            detachedSurfaceController.openBubble(generation),
        )
    }

    private fun commitDetachedOpen(mode: SurfaceMode, generation: Long, opened: Boolean) {
        if (opened) {
            surfaceMode = mode
            surfaceGeneration = generation
            return
        }
        val active = detachedSurfaceController.activeSurface
        surfaceMode = when (active?.mode) {
            DetachedSurfaceMode.MENU -> SurfaceMode.MENU
            DetachedSurfaceMode.BUBBLE -> SurfaceMode.BUBBLE
            null -> SurfaceMode.PET
        }
        if (active != null) {
            surfaceGeneration = active.generation
        } else {
            rebuildDispatcher()
        }
    }

    private fun closeReminderBubble() {
        reminderNotifications.cancel()
        sendWebEvent(JSONObject().put("type", "close-bubble"))
        collapseToPet()
    }

    private fun closeOverlayMenu() {
        sendWebEvent(JSONObject().put("type", "close-menu"))
        collapseToPet()
    }

    private fun collapseToPet() {
        cancelSurfaceRetry()
        detachedSurfaceController.close(surfaceGeneration)
        surfaceMode = SurfaceMode.PET
        surfaceGeneration += 1
        rebuildDispatcher()
    }

    private fun updatePetBounds() {
        val view = webView ?: return
        val params = layoutParams ?: return
        params.width = dpToPx(placement.sizeDp)
        params.height = dpToPx(placement.sizeDp)
        params.x = dpToPx(placement.x)
        params.y = dpToPx(placement.y)
        debugControls?.recordPetLayoutMutation("bounds", view, params)
        windowManager.updateViewLayout(view, params)
    }

    private fun updatePetPosition() {
        val view = webView ?: return
        val params = layoutParams ?: return
        params.x = dpToPx(placement.x)
        params.y = dpToPx(placement.y)
        debugControls?.recordPetLayoutMutation("position", view, params)
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
        sendWebEvent(JSONObject().put("type", "state-changed").put("snapshot", JSONObject(overlayRendererSnapshot(snapshot))))
    }

    private fun sendPlacementChanged() {
        sendWebEvent(JSONObject()
            .put("type", "placement-changed")
            .put("side", placementSide()))
    }

    private fun sendWebEvent(message: JSONObject) {
        webEventGate.send(message, ::dispatchWebEvent)
    }

    private fun sendSurfaceEvent(message: JSONObject) {
        cancelSurfaceRetry()
        pendingSurfaceEvent = JSONObject(message.toString())
        surfaceRetryIndex = 0
        sendWebEvent(message)
        mainHandler.postDelayed(surfaceRetryRunnable, SURFACE_RETRY_DELAYS_MS[surfaceRetryIndex++])
    }

    private fun acknowledgeSurface(mode: String, generation: Long) {
        val pending = pendingSurfaceEvent ?: return
        if (pending.optString("mode") == mode && pending.optLong("generation", -1L) == generation) {
            cancelSurfaceRetry()
        }
    }

    private fun cancelSurfaceRetry() {
        if (::mainHandler.isInitialized) mainHandler.removeCallbacks(surfaceRetryRunnable)
        pendingSurfaceEvent = null
        surfaceRetryIndex = 0
    }

    private fun dispatchWebEvent(message: JSONObject) {
        val script = "window.dispatchEvent(new CustomEvent('android-overlay-message',{detail:${message}}));"
        webView?.post { webView?.evaluateJavascript(script, null) }
    }

    private fun placementSide(): String =
        if (placement.x + placement.sizeDp / 2 >= (screenBounds.left + screenBounds.right) / 2) "right" else "left"

    protected open fun currentScreenBounds(): Bounds {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val metrics = windowManager.maximumWindowMetrics
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

    private fun dpToPx(value: Int): Int = (value * density).roundToInt()

    companion object {
        @Volatile
        internal var activeDebugInstance: PetOverlayService? = null
            private set

        private val SURFACE_RETRY_DELAYS_MS = longArrayOf(100L, 250L, 500L, 1_000L)
        const val START = "START"
        const val SHOW = "SHOW"
        const val HIDE = "HIDE"
        const val QUIT = "QUIT"
        const val STATE_CHANGED = "STATE_CHANGED"
        const val OPEN_REMINDER = "OPEN_REMINDER"
        const val SNOOZE_CURRENT = "SNOOZE_CURRENT"
        val COMMANDS: Set<String> = setOf(START, SHOW, HIDE, QUIT, STATE_CHANGED)

        private const val NOTIFICATION_CHANNEL_ID = "pet-overlay"
        private const val NOTIFICATION_ID = 5105
        private const val SHOW_REQUEST = 7101
        private const val SETTINGS_REQUEST = 7102
        private const val QUIT_REQUEST = 7103
        fun requestQuit(context: Context) {
            AndroidServiceLifecycle.forContext(context).quit()
            JobSchedulerReminderRecovery(context).apply {
                cancel()
                setRecoveryEnabled(false)
            }
            ReminderNotificationFactory(context).cancel()
            context.stopService(Intent(context, PetOverlayService::class.java))
            finishAndRemoveAppTasks(context)
        }

        private fun finishAndRemoveAppTasks(context: Context) {
            context.getSystemService(ActivityManager::class.java)
                .appTasks
                .forEach { task -> runCatching { task.finishAndRemoveTask() } }
        }
    }
}
