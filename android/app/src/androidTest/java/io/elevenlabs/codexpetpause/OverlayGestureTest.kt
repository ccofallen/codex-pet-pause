package io.elevenlabs.codexpetpause

import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Point
import android.graphics.Rect
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.view.InputDevice
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import android.webkit.WebView
import android.webkit.RenderProcessGoneDetail
import androidx.core.content.ContextCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import io.elevenlabs.codexpetpause.overlay.Attachment
import io.elevenlabs.codexpetpause.overlay.Bounds
import io.elevenlabs.codexpetpause.overlay.DetachedOverlaySurfaceController
import io.elevenlabs.codexpetpause.overlay.DetachedSurfaceAction
import io.elevenlabs.codexpetpause.overlay.DetachedSurfaceLoss
import io.elevenlabs.codexpetpause.overlay.DetachedSurfaceMode
import io.elevenlabs.codexpetpause.overlay.DetachedWebViewFactory
import io.elevenlabs.codexpetpause.overlay.OverlayMenuAction
import io.elevenlabs.codexpetpause.overlay.OverlayPlacement
import io.elevenlabs.codexpetpause.overlay.OverlayWebViewFactory
import io.elevenlabs.codexpetpause.overlay.PetOverlayDebugHooks
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import io.elevenlabs.codexpetpause.overlay.Side
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OverlayGestureTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
    }

    @After
    fun tearDown() {
        DeviceQa.stopService()
        DeviceQa.restoreRotation()
    }

    @Test
    fun firstRunOverlayDismissRetryResumeAndActivityDetach() {
        DeviceQa.setOverlayPermission(false)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            DeviceQa.awaitText("Phone navigation", "手机导航")
            DeviceQa.clickText("Enable floating pet", "启用悬浮宠物")
            DeviceQa.awaitText("Allow the pet to appear over other apps", "允许宠物显示在其他应用上层")
            DeviceQa.clickText("Open permission settings", "前往授权")
            DeviceQa.awaitSystemSettings()
            DeviceQa.pressBack()
            DeviceQa.awaitText("Enable floating pet", "启用悬浮宠物")
            assertFalse(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().petVisible)

            DeviceQa.clickText("Enable floating pet", "启用悬浮宠物")
            DeviceQa.awaitText("Allow the pet to appear over other apps", "允许宠物显示在其他应用上层")
            DeviceQa.clickText("Open permission settings", "前往授权")
            DeviceQa.awaitSystemSettings()
            DeviceQa.setOverlayPermission(true)
            DeviceQa.pressBack()
            DeviceQa.awaitCondition("granted permission should start the visible pet") {
                AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().petVisible &&
                    DeviceQa.overlayWindows().size == 1
            }
            assertEquals(1, DeviceQa.overlayWindows().size)
            DeviceQa.assertOverlayDrawsVisiblePixels()
        } finally {
            scenario.close()
        }

        DeviceQa.awaitCondition("settings Activity should detach") {
            DeviceQa.fullScreenTargetWindows().isEmpty()
        }
        assertEquals(1, DeviceQa.overlayWindows().size)
        assertTrue(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().serviceActive)
        assertTrue(DeviceQa.hasForegroundServiceNotification())
    }


    @Test
    fun transparentSizesDragSnapRetractRestoreAndIdle() {
        DeviceQa.setOverlayPermission(true)
        listOf("small" to 56, "medium" to 72, "large" to 96).forEach { (size, expectedDp) ->
            DeviceQa.stopService()
            DeviceQa.seedState(petSize = size)
            DeviceQa.startService(PetOverlayService.START)
            val bounds = DeviceQa.awaitOverlay()
            assertTrue(abs(bounds.width() - DeviceQa.dp(expectedDp)) <= DeviceQa.dp(3))
            assertTrue(abs(bounds.height() - DeviceQa.dp(expectedDp)) <= DeviceQa.dp(3))
            assertTrue(bounds.width() < DeviceQa.screenBounds().width() / 2)
            assertEquals(1, DeviceQa.overlayWindows().size)
        }

        DeviceQa.stopService()
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)
        val initial = DeviceQa.awaitOverlay()
        SystemClock.sleep(5_100)
        assertEquals(initial, DeviceQa.awaitOverlay())

        val screen = DeviceQa.screenBounds()
        val pointerOffset = DeviceQa.dp(14)
        DeviceQa.drag(Point(initial.left + pointerOffset, initial.centerY()), Point(screen.right - 2, initial.centerY()))
        val attached = DeviceQa.awaitOverlayChange(initial)
        assertTrue(abs(attached.right - screen.right) <= DeviceQa.dp(3))
        SystemClock.sleep(5_100)
        assertEquals(attached, DeviceQa.awaitOverlay())

        DeviceQa.drag(Point(attached.centerX(), attached.centerY()), Point(screen.right - 1, attached.centerY()))
        val retracted = DeviceQa.awaitOverlayChange(attached)
        val visibleWidth = (minOf(retracted.right, screen.right) - maxOf(retracted.left, screen.left))
            .coerceAtLeast(0)
        assertTrue(abs(visibleWidth - DeviceQa.dp(20)) <= DeviceQa.dp(4))

        val visibleLeft = maxOf(retracted.left, screen.left)
        val visibleRight = minOf(retracted.right, screen.right)
        val restoreTapX = if (retracted.right > screen.right) {
            visibleLeft + DeviceQa.dp(4)
        } else {
            visibleRight - DeviceQa.dp(4)
        }
        DeviceQa.tap(Point(restoreTapX, retracted.centerY()))
        var restored = Rect()
        DeviceQa.awaitCondition("retracted pet should restore from its visible handle") {
            restored = DeviceQa.overlayWindows().singleOrNull() ?: Rect()
            val restoredVisibleWidth = (
                minOf(restored.right, screen.right) - maxOf(restored.left, screen.left)
            ).coerceAtLeast(0)
            abs(restoredVisibleWidth - DeviceQa.dp(72)) <= DeviceQa.dp(3)
        }
        assertTrue(abs(restored.width() - DeviceQa.dp(72)) <= DeviceQa.dp(3))

        val end = Point(screen.centerX(), screen.centerY())
        DeviceQa.drag(Point(restored.left + pointerOffset, restored.centerY()), end)
        var detached = Rect()
        DeviceQa.awaitCondition("detached pet should settle under the drag pointer") {
            detached = DeviceQa.overlayWindows().singleOrNull() ?: Rect()
            abs(detached.left - (end.x - pointerOffset)) <= DeviceQa.dp(4)
        }
        assertTrue(detached.right < screen.right - DeviceQa.dp(24))
    }

    @Test
    fun doubleTapMenuSettingsHideAndQuitHaveSinglePetSemantics() {
        DeviceQa.setOverlayPermission(true)
        val controls = PetOverlayDebugHooks.install(400_000L)
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)

        DeviceQa.openMeasuredOverlayMenu(controls)
        DeviceQa.clickOverlayMenuItem(0)
        DeviceQa.awaitCondition("settings Activity should open") { DeviceQa.fullScreenTargetWindows().size == 1 }
        assertEquals(1, DeviceQa.overlayWindows().size)
        DeviceQa.pressBack()

        ActivityScenario.launch(MainActivity::class.java).use {
            DeviceQa.awaitText("Hide pet", "隐藏宠物")
            DeviceQa.openMeasuredOverlayMenu(controls)
            DeviceQa.clickOverlayMenuItem(1)
            DeviceQa.awaitCondition("hide should remove the pet") { DeviceQa.overlayWindows().isEmpty() }
            DeviceQa.awaitText("Show pet", "显示宠物")
        }
        assertTrue(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().serviceActive)
        assertTrue(DeviceQa.hasForegroundServiceNotification())

        DeviceQa.startService(PetOverlayService.SHOW)
        DeviceQa.openMeasuredOverlayMenu(controls)
        DeviceQa.clickOverlayMenuItem(2)
        DeviceQa.awaitCondition("quit should remove pet and notification") {
            DeviceQa.overlayWindows().isEmpty() && !DeviceQa.hasForegroundServiceNotification()
        }
        val quit = AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot()
        assertTrue(quit.quitRequested)
        assertFalse(quit.serviceActive)
    }

    @Test
    fun detachedMenuCyclesKeepPetWindowIdentityAndExactBoundsOnBothSafeEdges() {
        DeviceQa.setOverlayPermission(true)
        val controls = PetOverlayDebugHooks.install(100_000L)
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)

        listOf(false, true).forEach { rightEdge ->
            val baseline = DeviceQa.anchorPetAtSafeEdge(rightEdge)
            repeat(10) { cycle ->
                controls.clearPetLayoutMutations()
                controls.clearDetachedSurfaceWindowEvents()
                DeviceQa.doubleTap(Point(baseline.bounds.centerX(), baseline.bounds.centerY()))
                DeviceQa.awaitMeasuredMenuSurface(
                    baseline,
                    controls,
                    "MENU did not become ready on cycle $cycle at ${if (rightEdge) "RIGHT" else "LEFT"}",
                )
                DeviceQa.assertPetWindowStable(baseline)
                assertEquals(2, DeviceQa.overlayWindowRecords().size)

                DeviceQa.tap(Point(baseline.bounds.centerX(), baseline.bounds.centerY()))
                DeviceQa.awaitPetStableWhile(
                    baseline,
                    "MENU did not close on cycle $cycle at ${if (rightEdge) "RIGHT" else "LEFT"}",
                ) { snapshot -> snapshot.detachedWindows(baseline.id).isEmpty() }
                DeviceQa.assertPetWindowStable(baseline)
                assertEquals(1, DeviceQa.overlayWindowRecords().size)
                assertTrue(
                    "MENU cycle mutated pet layout: ${controls.petLayoutMutations()}",
                    controls.petLayoutMutations().isEmpty(),
                )
            }
        }
    }

    @Test
    fun rendererLossRecoveryFailureAndStaleCallbacksKeepOneDetachedWindowMaximum() {
        DeviceQa.setOverlayPermission(true)
        val createdViews = CopyOnWriteArrayList<WebView>()
        val losses = CopyOnWriteArrayList<DetachedSurfaceLoss>()
        val failNextCreate = AtomicBoolean(false)
        lateinit var controller: DetachedOverlaySurfaceController
        lateinit var realFactory: OverlayWebViewFactory

        DeviceQa.onMain {
            val safe = DeviceQa.safeScreenBounds()
            val density = DeviceQa.context.resources.displayMetrics.density.coerceAtLeast(1f)
            val widthDp = (safe.width() / density).roundToInt()
            val heightDp = (safe.height() / density).roundToInt()
            realFactory = OverlayWebViewFactory(DeviceQa.context, onMessage = {})
            controller = DetachedOverlaySurfaceController(
                context = DeviceQa.context,
                windowManager = DeviceQa.context.getSystemService(WindowManager::class.java),
                handler = Handler(Looper.getMainLooper()),
                screenBoundsProvider = { Bounds(widthDp, heightDp) },
                anchorProvider = {
                    OverlayPlacement(
                        x = (widthDp - 72).coerceAtLeast(0),
                        y = (heightDp / 2 - 36).coerceAtLeast(0),
                        sizeDp = 72,
                        attachment = Attachment.Edge(Side.RIGHT),
                    )
                },
                snapshotProvider = { JSONObject() },
                webViewFactory = DetachedWebViewFactory { mode, generation, onRendererGone, onMessage ->
                    if (failNextCreate.getAndSet(false)) error("forced renderer replacement failure")
                    realFactory.createDetached(mode, generation, onRendererGone, onMessage).also {
                        it.contentDescription = "detached-recovery-${createdViews.size}"
                        createdViews += it
                    }
                },
                onAction = {},
                onSurfaceLost = losses::add,
            )
            assertTrue(controller.openMenu(1L))
        }

        try {
            val first = createdViews.single()
            DeviceQa.onMain {
                assertTrue(first.webViewClient.onRenderProcessGone(first, DeviceQa.rendererGoneDetail()))
            }
            DeviceQa.awaitCondition("matching renderer loss did not create one replacement") {
                createdViews.size == 2 && controller.activeSurface?.generation == 1L &&
                    DeviceQa.onMainValue { createdViews.count { it.parent != null } } == 1
            }

            val recovered = createdViews.last()
            val recoveredClient = DeviceQa.onMainValue { recovered.webViewClient }
            DeviceQa.onMain { assertTrue(controller.openBubble(2L)) }
            DeviceQa.awaitCondition("newer BUBBLE did not replace the recovered MENU") {
                createdViews.size == 3 && controller.activeSurface?.let {
                    it.mode == DetachedSurfaceMode.BUBBLE && it.generation == 2L
                } == true && DeviceQa.onMainValue { createdViews.count { it.parent != null } } == 1
            }
            DeviceQa.onMain {
                assertTrue(recoveredClient.onRenderProcessGone(recovered, DeviceQa.rendererGoneDetail()))
            }
            DeviceQa.waitForIdle()
            assertEquals(3, createdViews.size)
            assertEquals(2L, controller.activeSurface?.generation)
            assertEquals(1, DeviceQa.onMainValue { createdViews.count { it.parent != null } })

            failNextCreate.set(true)
            val matchingFailure = createdViews.last()
            DeviceQa.onMain {
                assertTrue(
                    matchingFailure.webViewClient.onRenderProcessGone(
                        matchingFailure,
                        DeviceQa.rendererGoneDetail(),
                    ),
                )
            }
            DeviceQa.awaitCondition("matching replacement failure did not report surface loss") {
                losses.singleOrNull() == DetachedSurfaceLoss(DetachedSurfaceMode.BUBBLE, 2L)
            }
            assertNull(controller.activeSurface)
            assertEquals(0, DeviceQa.onMainValue { createdViews.count { it.parent != null } })

            DeviceQa.onMain {
                assertTrue(controller.openMenu(3L))
                val pending = createdViews.last()
                assertTrue(pending.webViewClient.onRenderProcessGone(pending, DeviceQa.rendererGoneDetail()))
                controller.close(3L)
            }
            DeviceQa.waitForIdle()
            assertEquals(4, createdViews.size)
            assertNull(controller.activeSurface)
            assertEquals(0, DeviceQa.onMainValue { createdViews.count { it.parent != null } })
        } finally {
            DeviceQa.onMain { controller.destroy() }
        }
    }

    @Test
    fun matchingSurfaceLossRestoresPetInteractionAndStaleLossCannotCloseNewerMenu() {
        DeviceQa.setOverlayPermission(true)
        val controls = PetOverlayDebugHooks.install(200_000L)
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)
        DeviceQa.awaitCondition("debug service seam did not observe the running overlay service") {
            PetOverlayService.activeDebugInstance != null
        }
        val service = requireNotNull(PetOverlayService.activeDebugInstance)
        try {
            val baseline = DeviceQa.anchorPetAtSafeEdge(rightEdge = true)
            controls.clearPetLayoutMutations()
            controls.clearDetachedSurfaceWindowEvents()
            DeviceQa.doubleTap(Point(baseline.bounds.centerX(), baseline.bounds.centerY()))
            val initialMenu = DeviceQa.awaitMeasuredMenuSurface(baseline, controls, "initial MENU did not render")

            val controller = DeviceQa.privateField<DetachedOverlaySurfaceController>(
                service,
                "detachedSurfaceController",
            )
            val failedMenu = DeviceQa.activeDetachedWebView(controller)
            DeviceQa.onMain {
                assertTrue(
                    failedMenu.webViewClient.onRenderProcessGone(
                        failedMenu,
                        DeviceQa.rendererGoneDetail(),
                    ),
                )
            }
            DeviceQa.awaitDetachedReplacement(baseline, initialMenu.id)
            DeviceQa.assertPetWindowStable(baseline)
            assertTrue("MENU renderer recovery touched the pet window", controls.petLayoutMutations().isEmpty())

            val lost = requireNotNull(controller.activeSurface).let {
                DetachedSurfaceLoss(it.mode, it.generation)
            }
            DeviceQa.onMain {
                controller.close(lost.generation)
                service.handleDetachedSurfaceLost(lost)
            }
            DeviceQa.awaitPetStableWhile(baseline, "matching surface loss did not return to PET") { snapshot ->
                snapshot.detachedWindows(baseline.id).isEmpty()
            }
            DeviceQa.assertPetWindowStable(baseline)

            controls.clearDetachedSurfaceWindowEvents()
            DeviceQa.doubleTap(Point(baseline.bounds.centerX(), baseline.bounds.centerY()))
            val newerMenu = DeviceQa.awaitMeasuredMenuSurface(
                baseline,
                controls,
                "pet interaction was not restored after matching surface loss",
            )
            val newer = requireNotNull(controller.activeSurface)
            assertTrue(newer.generation > lost.generation)

            DeviceQa.onMain { service.handleDetachedSurfaceLost(lost) }
            DeviceQa.waitForIdle()
            DeviceQa.assertPetWindowStable(baseline)
            assertEquals(newerMenu.id, DeviceQa.detachedWindows(baseline.id).single().id)
            assertEquals(newer.generation, controller.activeSurface?.generation)

            DeviceQa.tap(Point(baseline.bounds.centerX(), baseline.bounds.centerY()))
            DeviceQa.awaitPetStableWhile(baseline, "newer MENU did not close normally") { snapshot ->
                snapshot.detachedWindows(baseline.id).isEmpty()
            }
            DeviceQa.assertPetWindowStable(baseline)
            assertTrue(controls.petLayoutMutations().isEmpty())

            controls.clearDetachedSurfaceWindowEvents()
            DeviceQa.doubleTap(Point(baseline.bounds.centerX(), baseline.bounds.centerY()))
            val lifecycleMenu = DeviceQa.awaitMeasuredMenuSurface(
                baseline,
                controls,
                "lifecycle MENU did not render",
            )
            DeviceQa.pressHome()
            DeviceQa.awaitCondition("HOME did not move the active package away from the app") {
                DeviceQa.activePackage() != DeviceQa.context.packageName
            }
            DeviceQa.assertPetAndSurfaceStableFor(baseline, lifecycleMenu, 600L)
            ActivityScenario.launch(MainActivity::class.java).use {
                DeviceQa.awaitCondition("app did not return to the foreground") {
                    DeviceQa.activePackage() == DeviceQa.context.packageName
                }
                DeviceQa.awaitText("Phone navigation", "手机导航")
                DeviceQa.assertPetAndSurfaceStableFor(baseline, lifecycleMenu, 400L)
            }

            DeviceQa.forceLandscape()
            val rotated = DeviceQa.awaitSameWindowIdentities(baseline.id, lifecycleMenu.id)
            val rotatedPet = rotated.first
            val rotatedMenu = rotated.second
            DeviceQa.assertPetAndSurfaceStableFor(rotatedPet, rotatedMenu, 400L)
            controls.clearPetLayoutMutations()
            DeviceQa.tap(Point(rotatedPet.bounds.centerX(), rotatedPet.bounds.centerY()))
            DeviceQa.awaitPetStableWhile(rotatedPet, "rotated MENU did not close") { snapshot ->
                snapshot.detachedWindows(rotatedPet.id).isEmpty()
            }
            DeviceQa.assertPetWindowStable(rotatedPet)
            assertTrue("closing rotated MENU mutated pet layout", controls.petLayoutMutations().isEmpty())
        } finally {
            DeviceQa.stopService()
        }
    }

    @Test
    fun petRendererLossUsesInstalledFactoryClientAndRecreatesExactlyOneStablePet() {
        DeviceQa.setOverlayPermission(true)
        PetOverlayDebugHooks.install(300_000L)
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)
        val baseline = DeviceQa.awaitPetWindow()
        val service = requireNotNull(PetOverlayService.activeDebugInstance)
        val failedView = DeviceQa.privateField<WebView?>(service, "webView") ?: error("pet WebView missing")

        DeviceQa.onMain {
            assertTrue(failedView.webViewClient.onRenderProcessGone(failedView, DeviceQa.rendererGoneDetail()))
        }
        val replacement = DeviceQa.awaitPetReplacement(baseline)
        assertEquals(baseline.bounds, replacement.bounds)
        assertNotEquals(baseline.id, replacement.id)
        assertEquals(1, DeviceQa.overlayWindowRecords().size)
    }

    @Test
    fun debugReminderClockCannotMoveBackwardsUnderConcurrentWriters() {
        val controls = PetOverlayDebugHooks.install(400_000L)
        val start = CountDownLatch(1)
        val complete = CountDownLatch(16)
        (1L..16L).forEach { offset ->
            Thread {
                try {
                    start.await()
                    runCatching { controls.advanceClockTo(400_000L + offset) }
                } finally {
                    complete.countDown()
                }
            }.start()
        }
        start.countDown()
        assertTrue("concurrent clock writers did not finish", complete.await(5, TimeUnit.SECONDS))
        assertEquals(400_016L, controls.now())
        assertTrue(runCatching { controls.advanceClockTo(400_015L) }.isFailure)
        assertEquals(400_016L, controls.now())
    }

    @Test
    fun phoneLayoutTouchTargetsBilingualCopyAndNoDuplicateActivityPet() {
        DeviceQa.seedState(locale = "en")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            DeviceQa.awaitText("Phone navigation")
            listOf("Companion", "Reminders", "Pet", "Settings").forEach(DeviceQa::assertTouchTarget)
            assertTrue(DeviceQa.overlayWindows().isEmpty())
            scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
            DeviceQa.awaitCondition("landscape Activity should remain usable") {
                DeviceQa.fullScreenTargetWindows().size == 1
            }
            DeviceQa.assertTouchTarget("Settings")
        }

        DeviceQa.seedState(locale = "zh-CN")
        ActivityScenario.launch(MainActivity::class.java).use {
            DeviceQa.awaitText("手机导航")
            DeviceQa.assertTouchTarget("设置")
        }
        val en = DeviceQa.localizedContext(Locale.ENGLISH)
        val zh = DeviceQa.localizedContext(Locale.SIMPLIFIED_CHINESE)
        assertEquals("Show pet", en.getString(R.string.overlay_action_show))
        assertEquals("显示宠物", zh.getString(R.string.overlay_action_show))
        assertEquals("Quit", en.getString(R.string.overlay_action_quit))
        assertEquals("退出", zh.getString(R.string.overlay_action_quit))
    }
}

internal object DeviceQa {
    data class OverlayWindowRecord(val id: Int, val type: Int, val bounds: Rect)
    data class OverlayWindowSnapshot(val windows: List<OverlayWindowRecord>) {
        fun detachedWindows(petWindowId: Int): List<OverlayWindowRecord> =
            windows.filter { it.id != petWindowId }
    }

    private var orientationScenario: ActivityScenario<MainActivity>? = null
    private var qaStartedAt = 0L
    private var qaPid = Process.myPid()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context: Context = instrumentation.targetContext
    private val automation = instrumentation.uiAutomation.apply {
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
    }

    fun reset() {
        cancelPendingTouch()
        stopService()
        PetOverlayDebugHooks.clear()
        context.getSharedPreferences("android-overlay-lifecycle", Context.MODE_PRIVATE).edit().clear().commit()
        context.filesDir.resolve("state.json").delete()
        context.filesDir.resolve("pets").deleteRecursively()
        context.cacheDir.resolve("pending-pet-archives").deleteRecursively()
        context.getSystemService(NotificationManager::class.java).cancelAll()
        setOverlayPermission(false)
        qaStartedAt = System.currentTimeMillis()
        qaPid = Process.myPid()
    }

    fun seedState(
        petSize: String = "medium",
        locale: String = "en",
        soundEnabled: Boolean = true,
        reminders: JSONArray = defaultReminders(),
    ) {
        AndroidStateCoordinatorRegistry.clearForTests()
        val settings = JSONObject()
            .put("schemaVersion", 5).put("locale", locale).put("onboardingComplete", true)
            .put("theme", "system").put("petSize", petSize).put("soundEnabled", soundEnabled)
            .put("animationsEnabled", true).put("affinity", 0)
            .put("quietHours", JSONObject().put("enabled", false).put("startMinutes", 1320).put("endMinutes", 420))
            .put("runtime", JSONObject()).put("cat", JSONObject().put("name", "Momo"))
            .put("activePetId", "builtin-cat")
            .put("petPosition", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))
            .put("reminders", reminders)
        val snapshot = JSONObject().put("schemaVersion", 1).put("settingsJson", settings.toString())
            .put("historyJson", JSONArray()).put("pets", JSONArray())
            .put("overlay", JSONObject().put("xRatio", 0.62).put("yRatio", 0.48))
        context.filesDir.resolve("state.json").writeText(snapshot.toString())
    }

    fun defaultReminders(now: Long = System.currentTimeMillis()) = JSONArray().apply {
        put(reminder("lookAway", "lookAway", false, 20, now + 1_200_000L))
        put(reminder("drinkWater", "drinkWater", false, 45, now + 2_700_000L))
        put(reminder("standUp", "standUp", false, 60, now + 3_600_000L))
        put(reminder("takeBreak", "takeBreak", false, 90, now + 5_400_000L))
    }

    fun reminder(id: String, type: String, enabled: Boolean, minutes: Int, dueAt: Long) = JSONObject()
        .put("id", id).put("kind", "preset").put("type", type).put("enabled", enabled)
        .put("intervalMinutes", minutes).put("nextDueAt", dueAt)
        .put("status", if (enabled) "scheduled" else "disabled")

    fun setOverlayPermission(allowed: Boolean) {
        shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW ${if (allowed) "allow" else "deny"}")
        awaitCondition("overlay app-op did not change") { Settings.canDrawOverlays(context) == allowed }
    }

    fun grantNotifications() {
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
    }


    fun startService(action: String) = ContextCompat.startForegroundService(
        context,
        Intent(context, PetOverlayService::class.java).setAction(action),
    )

    fun stopService() {
        context.stopService(Intent(context, PetOverlayService::class.java))
        awaitCondition("overlay service did not fully destroy") {
            PetOverlayService.activeDebugInstance == null && overlayWindowRecords().isEmpty()
        }
    }

    fun awaitOverlay(): Rect {
        var result: OverlayWindowRecord? = null
        awaitCondition("floating overlay should be visible") {
            result = petWindows().singleOrNull()
            result != null
        }
        return Rect(requireNotNull(result).bounds)
    }

    fun awaitPetWindow(): OverlayWindowRecord {
        var result: OverlayWindowRecord? = null
        awaitCondition("floating pet window should be visible") {
            result = petWindows().singleOrNull()
            result != null
        }
        return requireNotNull(result)
    }

    fun anchorPetAtSafeEdge(rightEdge: Boolean): OverlayWindowRecord {
        val initial = awaitPetWindow()
        val safe = safeScreenBounds()
        val destination = Point(
            if (rightEdge) safe.right - 1 else safe.left + 1,
            initial.bounds.centerY().coerceIn(safe.top + dp(36), safe.bottom - dp(36)),
        )
        drag(Point(initial.bounds.centerX(), initial.bounds.centerY()), destination)
        var anchored: OverlayWindowRecord? = null
        awaitCondition("pet did not anchor at the ${if (rightEdge) "RIGHT" else "LEFT"} safe edge") {
            anchored = petWindows().singleOrNull()
            anchored?.let {
                it.id == initial.id && if (rightEdge) {
                    abs(it.bounds.right - safe.right) <= dp(3)
                } else {
                    abs(it.bounds.left - safe.left) <= dp(3)
                }
            } == true
        }
        return requireNotNull(anchored)
    }

    fun assertOverlayDrawsVisiblePixels() {
        pressHome()
        SystemClock.sleep(1_500)
        val bounds = awaitOverlay()
        val withPet = automation.takeScreenshot()
        startService(PetOverlayService.HIDE)
        awaitCondition("overlay should hide for pixel comparison") { overlayWindows().isEmpty() }
        SystemClock.sleep(800)
        val withoutPet = automation.takeScreenshot()
        val changed = changedPixels(withPet, withoutPet, bounds)
        withPet.recycle()
        withoutPet.recycle()
        startService(PetOverlayService.SHOW)
        awaitOverlay()
        assertTrue("floating pet rendered only $changed changed pixels", changed >= 2_000)
    }

    private fun changedPixels(first: Bitmap, second: Bitmap, bounds: Rect): Int {
        val clipped = Rect(bounds).apply {
            intersect(0, 0, minOf(first.width, second.width), minOf(first.height, second.height))
        }
        var changed = 0
        for (y in clipped.top until clipped.bottom) {
            for (x in clipped.left until clipped.right) {
                if (first.getPixel(x, y) != second.getPixel(x, y)) changed += 1
            }
        }
        return changed
    }

    fun pressHome() {
        shell("input keyevent KEYCODE_HOME")
    }

    fun awaitOverlayChange(previous: Rect): Rect {
        var result: Rect? = null
        awaitCondition("floating overlay bounds should change") {
            result = overlayWindows().singleOrNull()
            result != null && result != previous
        }
        return requireNotNull(result)
    }

    fun overlayWindows(): List<Rect> {
        return overlayWindowRecords().map { Rect(it.bounds) }
    }

    fun overlayWindowRecords(): List<OverlayWindowRecord> {
        val screen = screenBounds()
        return targetWindows().filter {
            it.type == AccessibilityWindowInfo.TYPE_SYSTEM ||
                (it.bounds.width() < screen.width() * 3 / 4 && it.bounds.height() < screen.height() * 3 / 4)
        }.map { OverlayWindowRecord(it.id, it.type, Rect(it.bounds)) }
    }

    fun petWindows(): List<OverlayWindowRecord> = overlayWindowRecords().filter {
        abs(it.bounds.width() - it.bounds.height()) <= dp(3) &&
            it.bounds.width() in dp(50)..dp(105)
    }

    fun detachedWindows(petWindowId: Int): List<OverlayWindowRecord> =
        overlayWindowRecords().filter { it.id != petWindowId }

    fun assertPetWindowStable(baseline: OverlayWindowRecord) {
        assertPetWindowStable(baseline, overlayWindowSnapshot())
    }

    private fun assertPetWindowStable(
        baseline: OverlayWindowRecord,
        snapshot: OverlayWindowSnapshot,
    ) {
        val current = snapshot.windows.singleOrNull { it.id == baseline.id }
        assertNotNull("pet window identity ${baseline.id} disappeared", current)
        assertEquals("pet window bounds changed", baseline.bounds, requireNotNull(current).bounds)
    }

    fun awaitPetStableWhile(
        baseline: OverlayWindowRecord,
        message: String,
        timeoutMillis: Long = 12_000L,
        condition: (OverlayWindowSnapshot) -> Boolean,
    ) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val snapshot = overlayWindowSnapshot()
            assertPetWindowStable(baseline, snapshot)
            if (condition(snapshot)) return
            SystemClock.sleep(25L)
        }
        throw AssertionError(message)
    }

    fun awaitDetachedSurface(
        baseline: OverlayWindowRecord,
        message: String,
        minimumWidth: Int = dp(2),
        minimumHeight: Int = dp(2),
    ): OverlayWindowRecord {
        var surface: OverlayWindowRecord? = null
        awaitPetStableWhile(baseline, message) { snapshot ->
            val detached = snapshot.detachedWindows(baseline.id)
            assertTrue("more than one detached window was attached: $detached", detached.size <= 1)
            surface = detached.singleOrNull()?.takeIf {
                it.bounds.width() >= minimumWidth && it.bounds.height() >= minimumHeight
            }
            surface != null
        }
        return requireNotNull(surface)
    }

    fun overlayWindowSnapshot(): OverlayWindowSnapshot = OverlayWindowSnapshot(overlayWindowRecords())

    fun assertPetAndSurfaceStableFor(
        pet: OverlayWindowRecord,
        surface: OverlayWindowRecord,
        durationMillis: Long,
    ) {
        val deadline = SystemClock.uptimeMillis() + durationMillis
        while (SystemClock.uptimeMillis() < deadline) {
            val snapshot = overlayWindowSnapshot()
            assertPetWindowStable(pet, snapshot)
            val currentSurface = snapshot.windows.singleOrNull { it.id == surface.id }
            assertNotNull("detached window identity ${surface.id} disappeared", currentSurface)
            assertEquals("detached window bounds changed", surface.bounds, requireNotNull(currentSurface).bounds)
            assertEquals(2, snapshot.windows.size)
            SystemClock.sleep(25L)
        }
    }

    fun awaitSameWindowIdentities(
        petId: Int,
        surfaceId: Int,
    ): Pair<OverlayWindowRecord, OverlayWindowRecord> {
        var pair: Pair<OverlayWindowRecord, OverlayWindowRecord>? = null
        awaitCondition("rotation recreated or duplicated an overlay window") {
            val snapshot = overlayWindowSnapshot()
            val pet = snapshot.windows.singleOrNull { it.id == petId }
            val surface = snapshot.windows.singleOrNull { it.id == surfaceId }
            if (pet != null && surface != null && snapshot.windows.size == 2) {
                pair = pet to surface
                true
            } else {
                false
            }
        }
        return requireNotNull(pair)
    }

    fun awaitPetReplacement(previous: OverlayWindowRecord): OverlayWindowRecord {
        var replacement: OverlayWindowRecord? = null
        awaitCondition("pet renderer replacement did not settle to one exact window") {
            val snapshot = overlayWindowSnapshot()
            val pets = snapshot.windows.filter {
                abs(it.bounds.width() - it.bounds.height()) <= dp(3) &&
                    it.bounds.width() in dp(50)..dp(105)
            }
            replacement = pets.singleOrNull()?.takeIf {
                it.id != previous.id && it.bounds == previous.bounds
            }
            replacement != null && snapshot.windows.size == 1
        }
        return requireNotNull(replacement)
    }

    fun fullScreenTargetWindows(): List<Rect> {
        val screen = screenBounds()
        return targetWindows().map { it.bounds }.filter {
            it.width() >= screen.width() * 3 / 4 && it.height() >= screen.height() * 3 / 4
        }
    }

    fun screenBounds(): Rect {
        val manager = context.getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= 30) return Rect(manager.maximumWindowMetrics.bounds)
        @Suppress("DEPRECATION")
        return Point().also { manager.defaultDisplay.getRealSize(it) }.let { Rect(0, 0, it.x, it.y) }
    }

    fun safeScreenBounds(): Rect {
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = context.getSystemService(WindowManager::class.java).currentWindowMetrics
            val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
            )
            val bounds = metrics.bounds
            return Rect(
                bounds.left + insets.left,
                bounds.top + insets.top,
                bounds.right - insets.right,
                bounds.bottom - insets.bottom,
            )
        }
        return screenBounds()
    }

    fun openMeasuredOverlayMenu(
        controls: io.elevenlabs.codexpetpause.overlay.PetOverlayDebugControls,
    ): OverlayWindowRecord {
        val pet = awaitPetWindow()
        controls.clearPetLayoutMutations()
        controls.clearDetachedSurfaceWindowEvents()
        doubleTap(Point(pet.bounds.centerX(), pet.bounds.centerY()))
        val menu = awaitMeasuredMenuSurface(pet, controls, "double tap did not open a measured MENU")
        assertPetWindowStable(pet)
        val events = controls.detachedSurfaceWindowEvents()
        assertEquals(
            "double tap must attach exactly one MENU",
            1,
            events.count {
                it.phase == io.elevenlabs.codexpetpause.overlay.DetachedSurfaceWindowPhase.ATTACHED &&
                    it.mode == DetachedSurfaceMode.MENU
            },
        )
        assertTrue(
            "double-tap MENU opening mutated the pet window: ${controls.petLayoutMutations()}",
            controls.petLayoutMutations().isEmpty(),
        )
        return menu
    }

    fun awaitMeasuredMenuSurface(
        pet: OverlayWindowRecord,
        controls: io.elevenlabs.codexpetpause.overlay.PetOverlayDebugControls,
        message: String,
    ): OverlayWindowRecord {
        var result: OverlayWindowRecord? = null
        awaitPetStableWhile(pet, message) { snapshot ->
            val events = controls.detachedSurfaceWindowEvents()
            val attachedIndex = events.indexOfFirst {
                it.phase == io.elevenlabs.codexpetpause.overlay.DetachedSurfaceWindowPhase.ATTACHED &&
                    it.mode == DetachedSurfaceMode.MENU
            }
            val attached = events.getOrNull(attachedIndex)
            val measuredIndex = events.indexOfLast {
                it.phase == io.elevenlabs.codexpetpause.overlay.DetachedSurfaceWindowPhase.LAYOUT_UPDATED &&
                    it.mode == DetachedSurfaceMode.MENU && it.touchable &&
                    it.widthDp > 1 && it.heightDp > 1 && attached != null &&
                    it.generation == attached.generation && it.viewIdentity == attached.viewIdentity
            }
            val measured = events.getOrNull(measuredIndex)
            val detached = snapshot.detachedWindows(pet.id).singleOrNull()
            val ready = attached != null && measured != null && measuredIndex > attachedIndex &&
                detached != null && detached.bounds.width() == measured.widthPx &&
                detached.bounds.height() == measured.heightPx
            if (ready) result = detached
            ready
        }
        return requireNotNull(result)
    }

    fun clickOverlayMenuItem(index: Int) {
        require(index in 0..2)
        val service = requireNotNull(PetOverlayService.activeDebugInstance)
        val controller = privateField<DetachedOverlaySurfaceController>(service, "detachedSurfaceController")
        val active = requireNotNull(controller.activeSurface)
        assertEquals(DetachedSurfaceMode.MENU, active.mode)
        val action = when (index) {
            0 -> OverlayMenuAction.SETTINGS
            1 -> OverlayMenuAction.HIDE
            else -> OverlayMenuAction.QUIT
        }
        assertTrue(
            "debug typed MENU action was not accepted",
            onMainValue {
                service.dispatchDebugDetachedSurfaceAction(
                    DetachedSurfaceAction.Menu(active.generation, action),
                )
            },
        )
    }

    fun clickReminderDoNow() {
        clickAccessibleText("Do it now")
        awaitText("Complete", "完成")
    }

    fun clickReminderComplete() {
        clickAccessibleText("Complete", "完成")
    }

    fun clickReminderSkip() {
        clickAccessibleText("Skip", "跳过")
    }

    fun clickReminderSnoozeFiveMinutes() {
        clickAccessibleText("Remind me later")
        clickAccessibleText("5 minutes")
    }

    fun dispatchReminderActionThroughRenderer(action: String, snoozeMinutes: Int? = null) {
        require(action == "complete" || action == "skip" || action == "snooze")
        if (action == "snooze") require(snoozeMinutes == 5 || snoozeMinutes == 10 || snoozeMinutes == 15)
        val service = requireNotNull(PetOverlayService.activeDebugInstance)
        val controller = privateField<DetachedOverlaySurfaceController>(service, "detachedSurfaceController")
        val active = requireNotNull(controller.activeSurface)
        assertEquals(DetachedSurfaceMode.BUBBLE, active.mode)
        val snapshot = JSONObject(
            requireNotNull(AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir).loadSnapshot()),
        )
        val settings = JSONObject(snapshot.getString("settingsJson"))
        val reminders = settings.getJSONArray("reminders")
        val reminderId = (0 until reminders.length())
            .map { reminders.getJSONObject(it) }
            .filter { it.getString("status") == "due" }
            .minWithOrNull(
                compareBy<JSONObject> {
                    if (it.has("snoozedUntil") && !it.isNull("snoozedUntil")) {
                        it.getDouble("snoozedUntil")
                    } else {
                        it.getDouble("nextDueAt")
                    }
                }.thenBy { it.getString("id") },
            )
            ?.getString("id")
            ?: error("no due reminder for detached BUBBLE")
        val message = JSONObject()
            .put("type", "surface-action")
            .put("mode", "BUBBLE")
            .put("generation", active.generation)
            .put("action", action)
            .put("reminderId", reminderId)
        if (snoozeMinutes != null) message.put("snoozeMinutes", snoozeMinutes)
        val evaluated = CountDownLatch(1)
        onMain {
            activeDetachedWebView(controller).evaluateJavascript(
                "window.AndroidOverlay.postMessage(${JSONObject.quote(message.toString())})",
            ) { evaluated.countDown() }
        }
        assertTrue(
            "detached renderer bridge did not evaluate $action",
            evaluated.await(5, TimeUnit.SECONDS),
        )
    }

    fun tap(point: Point) {
        val down = SystemClock.uptimeMillis()
        inject(MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, point.x.toFloat(), point.y.toFloat(), 0))
        SystemClock.sleep(70)
        inject(MotionEvent.obtain(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, point.x.toFloat(), point.y.toFloat(), 0))
    }
    fun doubleTap(point: Point) { tap(point); SystemClock.sleep(90); tap(point) }
    fun drag(from: Point, to: Point) = gesture(from, to, 420)

    private fun gesture(from: Point, to: Point, durationMs: Long) {
        val down = SystemClock.uptimeMillis()
        inject(MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, from.x.toFloat(), from.y.toFloat(), 0))
        repeat(12) { index ->
            val fraction = (index + 1) / 12f
            inject(MotionEvent.obtain(down, down + (durationMs * fraction).toLong(), MotionEvent.ACTION_MOVE,
                from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction, 0))
        }
        inject(MotionEvent.obtain(down, down + durationMs, MotionEvent.ACTION_UP, to.x.toFloat(), to.y.toFloat(), 0))
    }

    private fun cancelPendingTouch() {
        val now = SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0).apply {
            source = InputDevice.SOURCE_TOUCHSCREEN
        }
        try { automation.injectInputEvent(event, true) } finally { event.recycle() }
    }

    private fun inject(event: MotionEvent) {
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        try { assertTrue(automation.injectInputEvent(event, true)) } finally { event.recycle() }
    }

    fun awaitText(vararg labels: String): AccessibilityNodeInfo {
        var result: AccessibilityNodeInfo? = null
        awaitCondition("expected text was not visible: ${labels.toList()}") {
            result = labels.firstNotNullOfOrNull(::findNode)
            result != null
        }
        return requireNotNull(result)
    }

    fun clickText(vararg labels: String) {
        var node: AccessibilityNodeInfo? = awaitText(*labels)
        while (node != null && !node.isClickable) node = node.parent
        val bounds = Rect()
        requireNotNull(node).getBoundsInScreen(bounds)
        if (bounds.isEmpty) {
            assertTrue("offscreen click action failed", node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            return
        }
        tap(Point(bounds.centerX(), bounds.centerY()))
    }

    private fun clickAccessibleText(vararg labels: String) {
        var node: AccessibilityNodeInfo? = awaitText(*labels)
        while (node != null && !node.isClickable) node = node.parent
        assertTrue(
            "accessibility click failed for ${labels.toList()}",
            requireNotNull(node).performAction(AccessibilityNodeInfo.ACTION_CLICK),
        )
    }

    fun clickWebButton(scenario: ActivityScenario<MainActivity>, vararg labels: String) {
        val expected = labels.joinToString(",", prefix = "[", postfix = "]", transform = JSONObject::quote)
        awaitCondition("expected web button was not available: ${labels.toList()}") {
            javascript(
                scenario,
                "(() => {" +
                    "const button = Array.from(document.querySelectorAll('button')).find(" +
                    "candidate => $expected.includes(candidate.getAttribute('aria-label')));" +
                    "if (button === undefined || button.disabled) return false;" +
                    "button.click();" +
                    "return true;" +
                    "})()",
            ) == "true"
        }
    }

    fun webText(scenario: ActivityScenario<MainActivity>, testId: String): String {
        val raw = javascript(
            scenario,
            "JSON.stringify(document.querySelector('[data-testid=\"$testId\"]')?.textContent ?? '')",
        ) ?: return ""
        return if (raw == "null") "" else JSONArray("[$raw]").getString(0)
    }

    fun currentPssBytes(): Long {
        val memoryInfo = context.getSystemService(ActivityManager::class.java)
            .getProcessMemoryInfo(intArrayOf(Process.myPid()))
            .single()
        return memoryInfo.totalPss.toLong() * 1024L
    }

    fun stabilizeMemory() {
        Runtime.getRuntime().gc()
        System.runFinalization()
        instrumentation.waitForIdleSync()
        SystemClock.sleep(750L)
    }

    fun hasObservedAnr(): Boolean = exitReasons().any { it.reason == ApplicationExitInfo.REASON_ANR }

    fun hasObservedProcessDeath(): Boolean {
        if (Process.myPid() != qaPid) return true
        return exitReasons().any {
            it.reason == ApplicationExitInfo.REASON_CRASH ||
                it.reason == ApplicationExitInfo.REASON_CRASH_NATIVE ||
                it.reason == ApplicationExitInfo.REASON_LOW_MEMORY
        }
    }

    fun testAsset(name: String): ByteArray = instrumentation.context.assets.open(name).use { it.readBytes() }

    fun scrollTowardTop() {
        val bounds = screenBounds()
        repeat(3) {
            shell("input swipe ${bounds.centerX()} ${bounds.top + bounds.height() / 4} ${bounds.centerX()} ${bounds.top + bounds.height() * 3 / 4} 250")
            SystemClock.sleep(300)
        }
    }

    fun scrollTowardBottom() {
        val bounds = screenBounds()
        repeat(3) {
            shell("input swipe ${bounds.centerX()} ${bounds.top + bounds.height() * 3 / 4} ${bounds.centerX()} ${bounds.top + bounds.height() / 4} 250")
            SystemClock.sleep(300)
        }
    }

    fun clickPermissionButton(idSuffix: String) {
        var node: AccessibilityNodeInfo? = null
        awaitCondition("permission button was not visible") {
            node = allRoots().asSequence().flatMap(::walk).firstOrNull {
                it.viewIdResourceName?.endsWith(idSuffix) == true
            }
            node != null
        }
        assertTrue(requireNotNull(node).performAction(AccessibilityNodeInfo.ACTION_CLICK))
    }

    fun assertTouchTarget(label: String) {
        var node: AccessibilityNodeInfo? = awaitText(label)
        while (node != null && !node.isClickable) {
            node = node.parent ?: break
        }
        val bounds = Rect()
        requireNotNull(node).getBoundsInScreen(bounds)
        assertTrue("$label width was ${bounds.width()}px", bounds.width() >= dp(48))
        assertTrue("$label height was ${bounds.height()}px", bounds.height() >= dp(48))
    }

    fun awaitSystemSettings() = awaitCondition("Android settings should open") {
        automation.rootInActiveWindow?.packageName?.toString() == "com.android.settings"
    }

    fun pressBack() {
        assertTrue(automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK))
        SystemClock.sleep(250)
    }

    fun hasForegroundServiceNotification() =
        context.getSystemService(NotificationManager::class.java).activeNotifications.any {
            it.notification.category == Notification.CATEGORY_SERVICE
        }

    fun forceLandscape() {
        orientationScenario?.close()
        orientationScenario = ActivityScenario.launch(MainActivity::class.java).also { scenario ->
            scenario.onActivity { activity ->
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
        }
        awaitCondition("landscape orientation") {
            screenBounds().width() > screenBounds().height()
        }
    }

    fun restoreRotation() {
        orientationScenario?.close()
        orientationScenario = null
        shell("wm user-rotation free")
        shell("wm set-ignore-orientation-request reset")
    }

    fun localizedContext(locale: Locale): Context =
        android.content.res.Configuration(context.resources.configuration).also { it.setLocale(locale) }
            .let(context::createConfigurationContext)

    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun awaitCondition(message: String, timeoutMillis: Long = 12_000L, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeoutMillis
        var failure: Throwable? = null
        while (SystemClock.uptimeMillis() < deadline) {
            try { if (condition()) return } catch (caught: Throwable) { failure = caught }
            SystemClock.sleep(100)
        }
        throw AssertionError(message, failure)
    }

    fun waitForIdle() = instrumentation.waitForIdleSync()

    fun activePackage(): String? {
        val screen = screenBounds()
        return automation.windows.mapNotNull { window ->
            val root = window.root ?: return@mapNotNull null
            val bounds = Rect().also(window::getBoundsInScreen)
            if (bounds.width() < screen.width() * 3 / 4 || bounds.height() < screen.height() * 3 / 4) {
                return@mapNotNull null
            }
            root.packageName?.toString()?.let { it to bounds.width().toLong() * bounds.height() }
        }.maxByOrNull { it.second }?.first
    }

    fun activeDetachedWebView(controller: DetachedOverlaySurfaceController): WebView {
        val active = privateField<Any?>(controller, "activeWindow") ?: error("detached window missing")
        return privateField(active, "view")
    }

    fun awaitDetachedReplacement(
        pet: OverlayWindowRecord,
        failedWindowId: Int,
    ): OverlayWindowRecord {
        var replacement: OverlayWindowRecord? = null
        awaitPetStableWhile(pet, "detached renderer replacement did not settle") { snapshot ->
            replacement = snapshot.detachedWindows(pet.id).singleOrNull()?.takeIf {
                it.id != failedWindowId && it.bounds.width() >= dp(2) && it.bounds.height() >= dp(2)
            }
            replacement != null
        }
        return requireNotNull(replacement)
    }

    fun rendererGoneDetail(): RenderProcessGoneDetail = object : RenderProcessGoneDetail() {
        override fun didCrash(): Boolean = true
        override fun rendererPriorityAtExit(): Int = 0
    }

    fun onMain(action: () -> Unit) {
        val failure = AtomicReference<Throwable?>()
        instrumentation.runOnMainSync {
            try {
                action()
            } catch (caught: Throwable) {
                failure.set(caught)
            }
        }
        failure.get()?.let { throw it }
    }

    fun <T> onMainValue(action: () -> T): T {
        val value = AtomicReference<T>()
        onMain { value.set(action()) }
        return value.get()
    }

    @Suppress("UNCHECKED_CAST")
    fun <T> privateField(instance: Any, name: String): T {
        return instance.javaClass.getDeclaredField(name).let {
            it.isAccessible = true
            it.get(instance) as T
        }
    }

    private fun javascript(scenario: ActivityScenario<MainActivity>, source: String): String? {
        val result = AtomicReference<String?>()
        val completed = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.bridge.webView.evaluateJavascript(source) { value ->
                result.set(value)
                completed.countDown()
            }
        }
        assertTrue("JavaScript evaluation timed out", completed.await(5, TimeUnit.SECONDS))
        return result.get()
    }

    private fun exitReasons(): List<ApplicationExitInfo> {
        if (Build.VERSION.SDK_INT < 30) return emptyList()
        return context.getSystemService(ActivityManager::class.java)
            .getHistoricalProcessExitReasons(context.packageName, 0, 32)
            .filter { it.timestamp >= qaStartedAt }
    }

    private fun findNode(label: String) = allRoots().asSequence().flatMap(::walk).firstOrNull {
        it.text?.toString() == label || it.contentDescription?.toString() == label
    }

    private fun allRoots() = buildList {
        automation.rootInActiveWindow?.let(::add)
        automation.windows.mapNotNullTo(this) { it.root }
    }.distinctBy { it.windowId to it.hashCode() }

    private fun walk(root: AccessibilityNodeInfo): Sequence<AccessibilityNodeInfo> = sequence {
        yield(root)
        for (index in 0 until root.childCount) root.getChild(index)?.let { yieldAll(walk(it)) }
    }

    private fun targetWindows() = automation.windows.mapNotNull { window ->
        val root = window.root ?: return@mapNotNull null
        if (root.packageName?.toString() != context.packageName) return@mapNotNull null
        val bounds = Rect().also(window::getBoundsInScreen)
        WindowRecord(window.id, window.type, bounds)
    }

    private fun shell(command: String): String = automation.executeShellCommand(command).let {
        ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().use { reader -> reader.readText() }
    }

    private data class WindowRecord(val id: Int, val type: Int, val bounds: Rect)
}
