package io.elevenlabs.codexpetpause.overlay

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.MainActivity
import io.elevenlabs.codexpetpause.bridge.AndroidCommittedMutationEffects
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.bridge.deliverOverlayRefresh
import io.elevenlabs.codexpetpause.reminders.ReminderClock
import io.elevenlabs.codexpetpause.reminders.ReminderDeliveryScheduler
import io.elevenlabs.codexpetpause.reminders.ReminderEngine
import io.elevenlabs.codexpetpause.reminders.ReminderLiveTimer
import io.elevenlabs.codexpetpause.reminders.ReminderRecoveryScheduler
import io.elevenlabs.codexpetpause.reminders.ReminderTransition
import java.io.File
import java.util.IdentityHashMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.json.JSONArray
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PetOverlayServiceTest {
    @Test
    fun menuOpenAndCloseKeepRightEdgePetIdentityAndLayoutExact() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()
        val windowManager = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val pet = WebView(context)
        val petLayout = service.createPetLayoutParams(72, 72, 328, 640)
        setServiceField(service, "windowManager", windowManager)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", petLayout)
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        windowManager.petView = pet
        val before = petLayout.snapshot()

        invokeGestureResult(service, OpenMenu)

        assertPetWindowExact(service, pet, petLayout, before)
        val menu = requireNotNull(detachedController(service).activeSurface)
        assertEquals(DetachedSurfaceMode.MENU, menu.mode)

        invokeDetachedAction(service, DetachedSurfaceAction.Menu(menu.generation, OverlayMenuAction.CLOSE))

        assertEquals("PET", serviceField(service, "surfaceMode").toString())
        assertNull(detachedController(service).activeSurface)
        assertPetWindowExact(service, pet, petLayout, before)
        assertEquals(0, windowManager.petBoundsTransitions)
    }

    @Test
    fun bubbleOpenAndCloseKeepPetIdentityAndLayoutExact() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()
        val windowManager = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val pet = WebView(context)
        val petLayout = service.createPetLayoutParams(72, 72, 328, 640)
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        val detachedWebViews = ServiceDetachedWebViewFactory(context)
        setServiceField(service, "windowManager", windowManager)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", petLayout)
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        windowManager.petView = pet
        installDetachedController(service, windowManager, detachedWebViews)
        setServiceField(service, "reminderEngine", object : ReminderEngine(coordinator) {
            override fun pendingQueue(): List<String> = listOf("lookAway")
        })
        AndroidServiceLifecycle.forContext(context).start()
        AndroidServiceLifecycle.forContext(context).show()
        val before = petLayout.snapshot()

        invokeServiceNoArg(service, "openReminderBubble")
        val generation = serviceField(service, "surfaceGeneration") as Long
        val detachedView = detachedWebViews.created.single()
        detachedWebViews.postMessage(
            detachedView,
            """{"type":"surface-size-changed","mode":"BUBBLE","generation":$generation,"widthDp":208,"heightDp":260}""",
        )
        shadowOf(Looper.getMainLooper()).idle()

        assertPetWindowExact(service, pet, petLayout, before)
        assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
        assertEquals(1, windowManager.detachedBoundsTransitions)
        assertEquals(0, windowManager.petBoundsTransitions)

        invokeServiceNoArg(service, "closeReminderBubble")

        assertNull(detachedController(service).activeSurface)
        assertPetWindowExact(service, pet, petLayout, before)
        assertEquals(0, windowManager.petBoundsTransitions)
    }

    @Test
    fun menuFactoryFailureLeavesPetModeInteractiveWithoutPhantomSurface() {
        assertFailedMenuOpenLeavesInteractivePet(failFactory = true)
    }

    @Test
    fun menuAddViewFailureLeavesPetModeInteractiveWithoutPhantomSurface() {
        assertFailedMenuOpenLeavesInteractivePet(failFactory = false)
    }

    @Test
    fun bubbleFactoryFailureLeavesPetInteractiveAndRetriesPendingOnNextTap() {
        assertFailedBubbleOpenRetriesOnNextTap(failFactory = true)
    }

    @Test
    fun bubbleAddViewFailureLeavesPetInteractiveAndRetriesPendingOnNextTap() {
        assertFailedBubbleOpenRetriesOnNextTap(failFactory = false)
    }

    @Test
    fun menuRendererRecoveryFactoryFailureClearsModeAndRestoresPetInteraction() {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val webViews = ServiceDetachedWebViewFactory(context)
        val pet = WebView(context)
        setServiceField(service, "windowManager", windows)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        windows.petView = pet
        installDetachedController(service, windows, webViews)

        try {
            invokeGestureResult(service, OpenMenu)
            val failedView = webViews.created.single()
            webViews.failCreate = true

            webViews.rendererGone(failedView)
            shadowOf(Looper.getMainLooper()).idle()

            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
            assertEquals(OverlayTapAction.PET_INTERACTION, service.handlePetSingleTap())
            assertSame(pet, serviceField(service, "webView"))
            assertEquals(0, windows.petBoundsTransitions)
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun bubbleRendererRecoveryFactoryFailureClearsModeAndRetriesOnNextTap() {
        assertFailedBubbleRecoveryRetriesOnNextTap(failFactory = true)
    }

    @Test
    fun bubbleRendererRecoveryAddFailureClearsModeAndRetriesOnNextTap() {
        assertFailedBubbleRecoveryRetriesOnNextTap(failFactory = false)
    }

    @Test
    fun staleSurfaceLossCannotCloseNewerDetachedSurface() {
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val pet = WebView(context)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        invokeGestureResult(service, OpenMenu)
        val old = requireNotNull(detachedController(service).activeSurface)
        invokeDetachedAction(service, DetachedSurfaceAction.Menu(old.generation, OverlayMenuAction.CLOSE))
        invokeGestureResult(service, OpenMenu)
        val newer = requireNotNull(detachedController(service).activeSurface)

        service.handleDetachedSurfaceLost(DetachedSurfaceLoss(DetachedSurfaceMode.MENU, old.generation))

        assertSame(newer, detachedController(service).activeSurface)
        assertEquals("MENU", serviceField(service, "surfaceMode").toString())
        assertEquals(newer.generation, serviceField(service, "surfaceGeneration"))
        lifecycleController.destroy()
    }

    @Test
    fun measurementLayoutFailureRestoresPetModeAndPreservesPendingRetry() {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 10_000L) { service, engine ->
            val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
            val webViews = ServiceDetachedWebViewFactory(context)
            val pet = serviceField(service, "webView") as WebView
            windows.petView = pet
            setServiceField(service, "windowManager", windows)
            installDetachedController(service, windows, webViews)

            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            val failedView = webViews.created.single()
            val generation = requireNotNull(detachedController(service).activeSurface).generation
            windows.failUpdateCount = 1

            webViews.postMessage(
                failedView,
                """{"type":"surface-size-changed","mode":"BUBBLE","generation":$generation,"widthDp":208,"heightDp":260}""",
            )
            shadowOf(Looper.getMainLooper()).idle()

            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
            assertTrue(failedView.destroyedByServiceTest)
            assertSame(pet, serviceField(service, "webView"))
            assertEquals(0, windows.petBoundsTransitions)

            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
        }
    }

    @Test
    fun detachedReflowLayoutFailureRestoresOrdinaryPetInteraction() {
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val webViews = ServiceDetachedWebViewFactory(context)
        val pet = WebView(context)
        setServiceField(service, "windowManager", windows)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 40, 200))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(40, 200, 72, Attachment.Free))
        windows.petView = pet
        installDetachedController(service, windows, webViews)

        try {
            invokeGestureResult(service, OpenMenu)
            windows.failUpdateCount = 1

            detachedController(service).reflow()

            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
            assertEquals(OverlayTapAction.PET_INTERACTION, service.handlePetSingleTap())
            assertSame(pet, serviceField(service, "webView"))
            assertEquals(0, windows.petBoundsTransitions)
        } finally {
            lifecycleController.destroy()
        }
    }

    @Test
    fun displayBoundsReflowClampsInMemoryWithoutPersistingPlacement() {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(DisplayReflowPetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        coordinator.saveSettings(MEDIUM_SETTINGS)
        coordinator.saveOverlayPlacement(0.95, 0.90)
        val beforeRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
        val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val pet = WebView(context)
        windows.petView = pet
        setServiceField(service, "windowManager", windows)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        service.testBounds = Bounds(
            widthDp = 240,
            heightDp = 360,
            safeInsets = SafeInsets(left = 8, top = 12, right = 10, bottom = 16),
        )

        try {
            invokeServiceNoArg(service, "reflowOverlayForCurrentDisplay")

            val placement = serviceField(service, "placement") as OverlayPlacement
            val afterRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
            assertEquals(beforeRevision, afterRevision)
            assertTrue(placement.x in service.testBounds.left..(service.testBounds.right - placement.sizeDp))
            assertTrue(placement.y in service.testBounds.top..(service.testBounds.bottom - placement.sizeDp))
            assertFalse(serviceField(service, "placementDirty") as Boolean)
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun densityOnlyReflowDoesNotPersistPlacement() {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(DisplayReflowPetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        coordinator.saveSettings(MEDIUM_SETTINGS)
        coordinator.saveOverlayPlacement(0.55, 0.45)
        val beforeRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
        val bounds = Bounds(400, 800)
        val pet = WebView(context)
        setServiceField(
            service,
            "windowManager",
            CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).also {
                it.petView = pet
            },
        )
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 180, 320))
        setServiceField(service, "screenBounds", bounds)
        setServiceField(service, "placement", OverlayPlacement(180, 320, 72, Attachment.Free))
        setServiceField(service, "density", context.resources.displayMetrics.density + 0.5f)
        service.testBounds = bounds

        try {
            invokeServiceNoArg(service, "reflowOverlayForCurrentDisplay")

            val afterRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
            assertEquals(beforeRevision, afterRevision)
            assertFalse(serviceField(service, "placementDirty") as Boolean)
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun userDragStillPersistsPlacementOnPointerUp() {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        coordinator.saveSettings(MEDIUM_SETTINGS)
        val beforeRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
        val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val pet = WebView(context)
        windows.petView = pet
        setServiceField(service, "windowManager", windows)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 40, 200))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(40, 200, 72, Attachment.Free))

        try {
            invokeGestureResult(
                service,
                PlacementChanged(OverlayPlacement(220, 420, 72, Attachment.Free)),
            )
            assertTrue(serviceField(service, "placementDirty") as Boolean)
            val up = MotionEvent.obtain(0L, 16L, MotionEvent.ACTION_UP, 220f, 420f, 0)
            try {
                serviceMethod(service, "onOverlayTouch", View::class.java, MotionEvent::class.java)
                    .invoke(service, pet, up)
            } finally {
                up.recycle()
            }

            val after = JSONObject(requireNotNull(coordinator.loadSnapshot()))
            assertTrue(after.getLong("runtimeRevision") > beforeRevision)
            assertFalse(serviceField(service, "placementDirty") as Boolean)
            assertTrue(after.getJSONObject("overlay").getDouble("xRatio") > 0.5)
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun hideShowRestorationClampsPersistedPlacementToNewSafeBoundsWithoutWriting() {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(DisplayReflowPetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        coordinator.saveSettings(LARGE_SETTINGS)
        coordinator.saveOverlayPlacement(1.0, 1.0)
        val beforeRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
        setServiceField(
            service,
            "windowManager",
            NoOpWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager),
        )
        service.testBounds = Bounds(400, 800)

        try {
            invokeServiceNoArg(service, "showOverlay")
            invokeServiceNoArg(service, "hideOverlay")
            service.testBounds = Bounds(
                widthDp = 220,
                heightDp = 340,
                safeInsets = SafeInsets(left = 12, top = 18, right = 14, bottom = 22),
            )
            invokeServiceNoArg(service, "showOverlay")

            val placement = serviceField(service, "placement") as OverlayPlacement
            val afterRevision = JSONObject(requireNotNull(coordinator.loadSnapshot())).getLong("runtimeRevision")
            assertEquals(beforeRevision, afterRevision)
            assertTrue(placement.x in service.testBounds.left..(service.testBounds.right - placement.sizeDp))
            assertTrue(placement.y in service.testBounds.top..(service.testBounds.bottom - placement.sizeDp))
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun tapAtExactDeadlineReconcilesAndOpensBubbleBeforeScheduledTick() {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 10_000L) { service, engine ->
            invokeGestureResult(service, SingleTap)

            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals("BUBBLE", serviceField(service, "surfaceMode").toString())
            assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
        }
    }

    @Test
    fun tapAfterDeadlineReconcilesAndOpensBubbleBeforeScheduledTick() {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 9_999L) { service, engine ->
            invokeGestureResult(service, SingleTap)

            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals("BUBBLE", serviceField(service, "surfaceMode").toString())
            assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
        }
    }

    @Test
    fun tapBeforeDeadlineRemainsOrdinaryPetInteraction() {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 10_001L) { service, engine ->
            invokeGestureResult(service, SingleTap)

            assertTrue(engine.pendingQueue().isEmpty())
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
        }
    }

    @Test
    fun reminderDeadlineReconciliationNeverAutoOpensBubble() {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 10_000L) { service, engine ->
            invokeServiceNoArg(service, "reconcileReminders")

            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
        }
    }

    @Test
    fun failedAuthoritativeReconciliationNeverFallsThroughToOrdinaryPetClick() {
        withDeadlineService(
            now = 10_000L,
            lookAwayDueAt = 10_000L,
            serviceClass = FailingReconcilePetOverlayService::class.java,
        ) { service, engine ->
            assertNull(service.handlePetSingleTap())
            assertTrue(engine.pendingQueue().isEmpty())
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
        }
    }

    @Test
    fun failedReconciliationStillOpensAlreadyAuthoritativePendingReminder() {
        withDeadlineService(
            now = 10_000L,
            lookAwayDueAt = 10_000L,
            serviceClass = FailingReconcilePetOverlayService::class.java,
        ) { service, engine ->
            engine.reconcile(10_000L)

            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
        }
    }

    @Test
    fun serviceDestroyTearsDownItsOwnedDetachedController() {
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val pet = WebView(context)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        invokeGestureResult(service, OpenMenu)
        val ownedController = detachedController(service)
        assertEquals(DetachedSurfaceMode.MENU, ownedController.activeSurface?.mode)

        lifecycleController.destroy()

        assertSame(ownedController, serviceField(service, "detachedSurfaceController"))
        assertNull(ownedController.activeSurface)
    }

    @Test
    fun serviceDestroyContinuesPetCleanupWhenDetachedRemovalThrows() {
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val webViews = ServiceDetachedWebViewFactory(context)
        val pet = WebView(context)
        setServiceField(service, "windowManager", windows)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        installDetachedController(service, windows, webViews)
        invokeGestureResult(service, OpenMenu)
        windows.failRemove = true

        lifecycleController.destroy()

        assertNull(serviceField(service, "webView"))
        assertNull(detachedController(service).activeSurface)
        assertTrue(webViews.created.single().destroyedByServiceTest)
    }

    @Test
    fun typedReminderCompletionAdvancesToNextPendingThenClosesBubble() {
        withDeadlineService(
            now = 10_000L,
            lookAwayDueAt = 9_998L,
            drinkWaterDueAt = 9_999L,
        ) { service, engine ->
            invokeGestureResult(service, SingleTap)
            val first = requireNotNull(detachedController(service).activeSurface)
            assertEquals(listOf("lookAway", "drinkWater"), engine.pendingQueue())

            invokeDetachedAction(
                service,
                DetachedSurfaceAction.Reminder(first.generation, "lookAway", OverlayReminderAction.COMPLETE),
            )

            val second = requireNotNull(detachedController(service).activeSurface)
            assertEquals(DetachedSurfaceMode.BUBBLE, second.mode)
            assertTrue(second.generation > first.generation)
            assertEquals(listOf("drinkWater"), engine.pendingQueue())

            invokeDetachedAction(
                service,
                DetachedSurfaceAction.Reminder(second.generation, "drinkWater", OverlayReminderAction.COMPLETE),
            )

            assertTrue(engine.pendingQueue().isEmpty())
            assertNull(detachedController(service).activeSurface)
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
        }
    }

    @Test
    fun delayedLegacyMenuCallbacksCannotMutateNewDetachedMenuOrLifecycle() {
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val pet = WebView(context)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        val lifecycle = AndroidServiceLifecycle.forContext(context)
        lifecycle.start()
        lifecycle.show()
        invokeGestureResult(service, OpenMenu)
        val active = requireNotNull(detachedController(service).activeSurface)
        val application = ApplicationProvider.getApplicationContext<android.app.Application>()
        val applicationShadow = shadowOf(application)
        while (applicationShadow.nextStartedActivity != null) Unit

        service.handleWebMessage(OverlayWebMessage.MenuAction(OverlayMenuAction.SETTINGS))
        service.handleWebMessage(OverlayWebMessage.MenuAction(OverlayMenuAction.CLOSE))
        service.handleWebMessage(OverlayWebMessage.MenuAction(OverlayMenuAction.HIDE))
        service.handleWebMessage(OverlayWebMessage.MenuAction(OverlayMenuAction.QUIT))

        assertSame(active, detachedController(service).activeSurface)
        assertTrue(lifecycle.snapshot().serviceActive)
        assertTrue(lifecycle.snapshot().petVisible)
        assertFalse(lifecycle.snapshot().quitRequested)
        assertNull(applicationShadow.nextStartedActivity)
        lifecycleController.destroy()
    }

    @Test
    fun duplicateLegacyReminderAndMeasurementCallbacksCannotMutateDetachedBubble() {
        withDeadlineService(
            now = 10_000L,
            lookAwayDueAt = 9_998L,
            drinkWaterDueAt = 9_999L,
        ) { service, engine ->
            invokeGestureResult(service, SingleTap)
            val active = requireNotNull(detachedController(service).activeSurface)

            repeat(2) {
                service.handleWebMessage(
                    OverlayWebMessage.ReminderAction("lookAway", OverlayReminderAction.COMPLETE),
                )
                service.handleWebMessage(
                    OverlayWebMessage.BubbleSizeChanged("BUBBLE", active.generation, 320, 400),
                )
            }

            assertSame(active, detachedController(service).activeSurface)
            assertEquals(listOf("lookAway", "drinkWater"), engine.pendingQueue())
            assertEquals(1, active.widthDp)
            assertEquals(1, active.heightDp)
        }
    }

    @Test
    fun rendererLossCallbackRecreatesAndReplaysMenuAfterReplacementReady() {
        val service = rendererRecoveryService()
        val failedFactory = requireNotNull(service.currentOverlayWebViewFactory)
        val failedView = requireNotNull(serviceField(service, "webView") as WebView?)
        setServiceField(service, "surfaceMode", rendererSurfaceMode("MENU"))
        setServiceField(service, "surfaceGeneration", 71L)

        assertTrue(failedFactory.rendererClient.onRenderProcessGone(failedView, rendererGoneDetail()))
        shadowOf(Looper.getMainLooper()).idle()

        val replacementFactory = requireNotNull(service.currentOverlayWebViewFactory)
        signalOverlayReady(replacementFactory)
        shadowOf(Looper.getMainLooper()).idleFor(250, java.util.concurrent.TimeUnit.MILLISECONDS)

        assertEquals("MENU", serviceField(service, "surfaceMode").toString())
        assertEquals(71L, serviceField(service, "surfaceGeneration"))
        assertEquals(DetachedSurfaceMode.MENU, detachedController(service).activeSurface?.mode)
        assertEquals(71L, detachedController(service).activeSurface?.generation)
    }

    @Test
    fun rendererLossCallbackRecreatesAndReplaysBubbleAfterReplacementReady() {
        val service = rendererRecoveryService(activeReminder = true)
        val failedFactory = requireNotNull(service.currentOverlayWebViewFactory)
        val failedView = requireNotNull(serviceField(service, "webView") as WebView?)
        setServiceField(service, "surfaceMode", rendererSurfaceMode("BUBBLE"))
        setServiceField(service, "surfaceGeneration", 72L)

        assertTrue(failedFactory.rendererClient.onRenderProcessGone(failedView, rendererGoneDetail()))
        shadowOf(Looper.getMainLooper()).idle()

        val replacementFactory = requireNotNull(service.currentOverlayWebViewFactory)
        signalOverlayReady(replacementFactory)

        assertEquals("BUBBLE", serviceField(service, "surfaceMode").toString())
        assertEquals(72L, serviceField(service, "surfaceGeneration"))
        assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
        assertEquals(72L, detachedController(service).activeSurface?.generation)
    }

    @Test
    fun lifecycleHideCancelsQueuedRendererReplacementBeforeItRuns() {
        val service = rendererRecoveryService()
        val failedFactory = requireNotNull(service.currentOverlayWebViewFactory)
        val failedView = requireNotNull(serviceField(service, "webView") as WebView?)

        assertTrue(failedFactory.rendererClient.onRenderProcessGone(failedView, rendererGoneDetail()))
        shadowOf(Looper.getMainLooper()).runOneTask()
        assertTrue(serviceField(service, "overlayRendererRecreationScheduled") as Boolean)
        assertNull(serviceField(service, "webView"))
        assertNull(service.currentOverlayWebViewFactory)
        val queuedReplacement = serviceField(service, "overlayRendererRecreationRunnable") as Runnable

        service.onStartCommand(Intent(context, RecoveryPetOverlayService::class.java).setAction(PetOverlayService.HIDE), 0, 2)
        queuedReplacement.run()
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(1L, serviceField(service, "overlayWebViewGeneration"))
        assertNull(serviceField(service, "webView"))
        assertNull(service.currentOverlayWebViewFactory)
    }

    @Test
    fun rendererRecoveryReadyReplaysCapturedMenuWithItsGeneration() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()
        val webView = WebView(context)
        val windowManager = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        setServiceField(service, "webView", webView)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72))
        setServiceField(service, "windowManager", windowManager)
        setServiceField(service, "surfaceMode", rendererSurfaceMode("PET"))
        setServiceField(service, "surfaceGeneration", 1L)
        setServiceField(service, "pendingRendererSurface", rendererSurface("MENU", 41L))
        AndroidServiceLifecycle.forContext(context).start()
        AndroidServiceLifecycle.forContext(context).show()

        try {
            service.handleWebMessage(OverlayWebMessage.Ready)

            assertEquals("MENU", serviceField(service, "surfaceMode").toString())
            assertEquals(41L, serviceField(service, "surfaceGeneration"))
        } finally {
            webView.destroy()
        }
    }

    @Test
    fun rendererRecoveryReadyReplaysCapturedBubbleWithItsGeneration() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()
        val webView = WebView(context)
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        setServiceField(service, "reminderEngine", object : io.elevenlabs.codexpetpause.reminders.ReminderEngine(coordinator) {
            override fun pendingQueue(): List<String> = listOf("lookAway")
        })
        setServiceField(service, "webView", webView)
        setServiceField(service, "surfaceMode", rendererSurfaceMode("PET"))
        setServiceField(service, "surfaceGeneration", 1L)
        setServiceField(service, "pendingRendererSurface", rendererSurface("BUBBLE", 42L))
        AndroidServiceLifecycle.forContext(context).start()
        AndroidServiceLifecycle.forContext(context).show()

        try {
            service.handleWebMessage(OverlayWebMessage.Ready)

            assertEquals("BUBBLE", serviceField(service, "surfaceMode").toString())
            assertEquals(42L, serviceField(service, "surfaceGeneration"))
        } finally {
            webView.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun cancellingRendererRecoveryPreventsThePostedRecoveryFromRunning() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()
        val failed = WebView(context)
        setServiceField(service, "webView", failed)
        setServiceField(service, "overlayWebViewGeneration", 3L)

        try {
            assertTrue(service.scheduleOverlayRendererRecovery(failed, 3L))
            service.javaClass.getDeclaredMethod("cancelOverlayRendererRecreation").apply { isAccessible = true }
                .invoke(service)
            shadowOf(Looper.getMainLooper()).idle()

            assertEquals(failed, serviceField(service, "webView"))
            assertNull(serviceField(service, "overlayRendererRecoveryRunnable"))
        } finally {
            failed.destroy()
        }
    }

    @Test
    fun registeredFactoryClientReportsOnlyItsExactFailedWebViewOnce() {
        val failedViews = mutableListOf<WebView>()
        val factory = OverlayWebViewFactory(context, onRendererGone = failedViews::add) { }
        val webView = factory.create()

        try {
            assertTrue(factory.rendererClient.onRenderProcessGone(webView, rendererGoneDetail()))
            assertTrue(factory.rendererClient.onRenderProcessGone(webView, rendererGoneDetail()))

            assertEquals(listOf(webView), failedViews)
        } finally {
            webView.destroy()
        }
    }

    @Test
    fun staleRendererLossCannotRecoverAReplacementOverlay() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()
        val failed = WebView(context)
        val replacement = WebView(context)
        setServiceField(service, "webView", replacement)
        setServiceField(service, "overlayWebViewGeneration", 2L)

        try {
            assertFalse(service.scheduleOverlayRendererRecovery(failed, 1L))
        } finally {
            failed.destroy()
            replacement.destroy()
        }
    }

    @Test
    fun rendererLossRecreatesOnlyForAVisiblePetWithOverlayPermission() {
        assertTrue(shouldRecreateOverlayAfterRendererLoss(petVisible = true, overlayGranted = true))
        assertFalse(shouldRecreateOverlayAfterRendererLoss(petVisible = false, overlayGranted = true))
        assertFalse(shouldRecreateOverlayAfterRendererLoss(petVisible = true, overlayGranted = false))
    }

    @Test
    fun liveServiceRefreshesOneBoundsTransitionForCommittedPetSizeMutation() {
        File(context.filesDir, "state.json").delete()
        val controller = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = controller.get()
        val windowManager = CountingWindowManager(
            context.getSystemService(Context.WINDOW_SERVICE) as WindowManager,
        )
        val webView = WebView(context)
        setServiceField(service, "windowManager", windowManager)
        setServiceField(service, "webView", webView)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72))
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        coordinator.saveSettings(MEDIUM_SETTINGS)
        var refreshPublications = 0
        var fallbackCalls = 0

        try {
            val result = AndroidCommittedMutationEffects.run(
                mutation = { coordinator.saveSettings(LARGE_SETTINGS) },
                emitSnapshot = {},
                refreshOverlay = {
                    deliverOverlayRefresh(
                        publish = {
                            refreshPublications += 1
                            PetOverlayStateRefreshBus.publish()
                        },
                        fallback = {
                            fallbackCalls += 1
                            null
                        },
                    )?.let { throw it }
                },
            )
            shadowOf(Looper.getMainLooper()).idle()

            assertNull(result.refreshWarning)
            assertEquals(1, refreshPublications)
            assertEquals(0, fallbackCalls)
            assertEquals(1, windowManager.boundsTransitions)
        } finally {
            controller.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    @Test
    fun immutablePetLoaderAcceptsDottedIdsAllowedByTheImportProtocol() {
        val revision = "fedcba9876543210fedcba9876543210"
        val spritesheet = File(context.filesDir, "pets/moon.cat/$revision/spritesheet.webp")
        spritesheet.parentFile!!.mkdirs()
        spritesheet.writeBytes(byteArrayOf(1, 2, 3))
        val factory = OverlayWebViewFactory(context) { }

        val response = factory.intercept(
            Uri.parse("https://appassets.androidplatform.net/pet-assets/pets/moon.cat/$revision/spritesheet.webp"),
        )

        assertEquals(200, response.statusCode)
    }

    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun overlayRendererSnapshotRemovesLargePersistedPayloads() {
        val snapshot = JSONObject()
            .put("settingsJson", "{}")
            .put("historyJson", JSONArray().put(JSONObject().put("large", true)))
            .put(
                "pets",
                JSONArray().put(
                    JSONObject()
                        .put("id", "boba")
                        .put("metadataJson", "{\"id\":\"boba\"}")
                        .put("assetPath", "pets/boba/revision/spritesheet.webp")
                        .put("spritesheetBase64", "a".repeat(4096)),
                ),
            )
            .put(
                "overlay",
                JSONObject()
                    .put("xRatio", 0.5)
                    .put("yRatio", 0.5)
                    .put(
                        "activePet",
                        JSONObject()
                            .put("id", "boba")
                            .put("metadataJson", "{\"id\":\"boba\"}")
                            .put("assetPath", "pets/boba/revision/spritesheet.webp")
                            .put("spritesheetBase64", "b".repeat(4096)),
                    ),
            )

        val renderer = JSONObject(overlayRendererSnapshot(snapshot.toString()))
        val activePet = renderer.getJSONObject("overlay").getJSONObject("activePet")

        assertEquals(0, renderer.getJSONArray("pets").length())
        assertEquals(0, renderer.getJSONArray("historyJson").length())
        assertEquals("boba", activePet.getString("id"))
        assertTrue(activePet.getString("assetPath").endsWith("spritesheet.webp"))
        assertFalse(renderer.toString().contains("spritesheetBase64"))
    }

    @Before
    fun resetLifecycle() {
        AndroidServiceLifecycle.forContext(context).preferences.edit().clear().commit()
    }

    @After
    fun cleanupLifecycle() {
        AndroidServiceLifecycle.forContext(context).preferences.edit().clear().commit()
    }

    @Test
    fun windowUsesTransparentMinimalBoundsLayout() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()

        val params = service.createPetLayoutParams(widthPx = 72, heightPx = 96, xPx = 8, yPx = 16)

        assertEquals(PixelFormat.TRANSLUCENT, params.format)
        assertEquals(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, params.type)
        assertTrue(params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE != 0)
        assertTrue(params.flags and WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN != 0)
        assertNotEquals(WindowManager.LayoutParams.MATCH_PARENT, params.width)
        assertNotEquals(WindowManager.LayoutParams.MATCH_PARENT, params.height)
        assertEquals(72, params.width)
        assertEquals(96, params.height)
        assertEquals(8, params.x)
        assertEquals(16, params.y)
        assertEquals("", params.title?.toString().orEmpty())
    }

    @Test
    fun pendingReminderTapIsOwnedByTheNativeBubbleTransition() {
        assertEquals(OverlayTapAction.OPEN_REMINDER, overlayTapAction(hasPendingReminder = true))
        assertEquals(OverlayTapAction.PET_INTERACTION, overlayTapAction(hasPendingReminder = false))
    }

    @Test
    fun bundledOverlayEntryResolvesFromThePackagedPublicAssetsDirectory() {
        val factory = OverlayWebViewFactory(ApplicationProvider.getApplicationContext()) { }
        val response = factory.intercept(Uri.parse(OverlayWebViewFactory.OVERLAY_URL))
        val html = response.data.bufferedReader().use { it.readText() }

        assertEquals("https://appassets.androidplatform.net/app/index.html?overlay=1", OverlayWebViewFactory.OVERLAY_URL)
        assertEquals(200, response.statusCode)
        assertEquals("text/html", response.mimeType)
        assertTrue(html.contains("width=600, initial-scale=1.0"))
        assertFalse(html.contains("width=device-width"))
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
            assertTrue(webView.settings.useWideViewPort)
            assertFalse(webView.settings.loadWithOverviewMode)
            assertFalse(webView.settings.supportZoom())
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
        dispatcher.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 249))
        scheduler.runScheduled()
        dispatcher.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 301))

        assertEquals(listOf(OpenMenu), results)
    }

    @Test
    fun scheduledWaitAndBoundaryDownProduceSingleTapInEitherCallbackOrder() {
        val waitFirstScheduler = RecordingWaitScheduler()
        val waitFirstResults = mutableListOf<OverlayGestureResult>()
        val waitFirst = OverlayGestureDispatcher(interpreter(), waitFirstScheduler, waitFirstResults::add)
        waitFirst.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 0))
        waitFirst.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 0))
        waitFirstScheduler.runScheduled()
        waitFirst.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = DOUBLE_TAP_WINDOW_MS))
        waitFirst.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = DOUBLE_TAP_WINDOW_MS + 16))

        val downFirstScheduler = RecordingWaitScheduler()
        val downFirstResults = mutableListOf<OverlayGestureResult>()
        val downFirst = OverlayGestureDispatcher(interpreter(), downFirstScheduler, downFirstResults::add)
        downFirst.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 0))
        downFirst.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 0))
        downFirst.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = DOUBLE_TAP_WINDOW_MS))
        downFirstScheduler.runScheduled()
        downFirst.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = DOUBLE_TAP_WINDOW_MS + 16))

        assertEquals(listOf(SingleTap), waitFirstResults)
        assertEquals(listOf(SingleTap), downFirstResults)
    }

    @Test
    fun declaresOnlyTheRequiredServiceCommands() {
        assertEquals(
            setOf("START", "SHOW", "HIDE", "QUIT", "STATE_CHANGED"),
            PetOverlayService.COMMANDS,
        )
    }

    @Test
    @Config(sdk = [35], qualifiers = "en")
    fun foregroundNotificationOffersShowSettingsAndQuitActions() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()

        val notification = service.buildForegroundNotification()

        assertEquals(listOf("Show pet", "Open settings", "Quit"), notification.actions.map { it.title.toString() })
        assertEquals(PetOverlayService.SHOW, shadowOf(notification.actions[0].actionIntent).savedIntent.action)
        assertEquals(MainActivity::class.java.name, shadowOf(notification.actions[1].actionIntent).savedIntent.component?.className)
        assertEquals(PetOverlayService.QUIT, shadowOf(notification.actions[2].actionIntent).savedIntent.action)
    }

    @Test
    @Config(sdk = [35], qualifiers = "zh-rCN")
    fun foregroundNotificationActionsHaveCompleteChineseCopy() {
        val service = Robolectric.buildService(PetOverlayService::class.java).create().get()

        assertEquals(
            listOf("显示宠物", "打开设置", "退出"),
            service.buildForegroundNotification().actions.map { it.title.toString() },
        )
    }

    @Test
    fun staleStartShowAndOpenReminderIntentsCannotClearQuit() {
        val lifecycle = AndroidServiceLifecycle.forContext(context)
        lifecycle.start()
        lifecycle.quit()

        listOf(
            PetOverlayService.START,
            PetOverlayService.SHOW,
            PetOverlayService.OPEN_REMINDER,
        ).forEachIndexed { index, action ->
            val controller = Robolectric.buildService(PetOverlayService::class.java).create()
            val service = controller.get()

            val result = service.onStartCommand(
                Intent(context, PetOverlayService::class.java).setAction(action),
                0,
                index + 1,
            )

            assertEquals(Service.START_NOT_STICKY, result)
            assertFalse(lifecycle.snapshot().serviceActive)
            assertFalse(lifecycle.snapshot().petVisible)
            assertTrue(lifecycle.snapshot().quitRequested)
            controller.destroy()
        }
    }

    @Test
    fun overlayMenuHidePersistsThroughBridgeAndStickyServiceRecreation() {
        val lifecycle = AndroidServiceLifecycle.forContext(context)
        lifecycle.start()
        lifecycle.show()
        val firstController = Robolectric.buildService(PetOverlayService::class.java).create()
        val firstService = firstController.get()
        setServiceField(firstService, "webView", WebView(context))
        setServiceField(firstService, "layoutParams", firstService.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(firstService, "screenBounds", Bounds(400, 800))
        setServiceField(firstService, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        invokeGestureResult(firstService, OpenMenu)
        val menu = requireNotNull(detachedController(firstService).activeSurface)

        invokeDetachedAction(
            firstService,
            DetachedSurfaceAction.Menu(menu.generation, OverlayMenuAction.HIDE),
        )

        assertTrue(lifecycle.snapshot().serviceActive)
        assertFalse(lifecycle.snapshot().petVisible)
        firstController.destroy()

        val recreatedController = Robolectric.buildService(PetOverlayService::class.java).create()
        val recreated = recreatedController.get()
        assertEquals(Service.START_STICKY, recreated.onStartCommand(null, 0, 2))
        assertFalse(lifecycle.snapshot().petVisible)
        recreatedController.destroy()
    }

    private fun withDeadlineService(
        now: Long,
        lookAwayDueAt: Long,
        drinkWaterDueAt: Long? = null,
        serviceClass: Class<out PetOverlayService> = PetOverlayService::class.java,
        block: (PetOverlayService, ReminderEngine) -> Unit,
    ) {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(serviceClass).create()
        val service = lifecycleController.get()
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        coordinator.saveSettings(deadlineSettings(lookAwayDueAt, drinkWaterDueAt))
        val clock = ReminderClock { now }
        val engine = ReminderEngine(coordinator, clock)
        setServiceField(service, "reminderEngine", engine)
        setServiceField(
            service,
            "reminderDelivery",
            ReminderDeliveryScheduler(engine, clock, NoOpReminderLiveTimer, NoOpReminderRecoveryScheduler),
        )
        setServiceField(service, "webView", WebView(context))
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        AndroidServiceLifecycle.forContext(context).start()
        AndroidServiceLifecycle.forContext(context).show()

        try {
            block(service, engine)
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    private fun assertFailedMenuOpenLeavesInteractivePet(failFactory: Boolean) {
        File(context.filesDir, "state.json").delete()
        val lifecycleController = Robolectric.buildService(PetOverlayService::class.java).create()
        val service = lifecycleController.get()
        val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        val webViews = ServiceDetachedWebViewFactory(context)
        val pet = WebView(context)
        setServiceField(service, "windowManager", windows)
        setServiceField(service, "webView", pet)
        setServiceField(service, "layoutParams", service.createPetLayoutParams(72, 72, 328, 640))
        setServiceField(service, "screenBounds", Bounds(400, 800))
        setServiceField(service, "placement", OverlayPlacement(328, 640, 72, Attachment.Free))
        windows.petView = pet
        installDetachedController(service, windows, webViews)
        if (failFactory) webViews.failCreate = true else windows.failAddCount = 1

        try {
            invokeGestureResult(service, OpenMenu)

            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
            assertEquals(OverlayTapAction.PET_INTERACTION, service.handlePetSingleTap())
            assertSame(pet, serviceField(service, "webView"))
            assertEquals(0, windows.petBoundsTransitions)
        } finally {
            lifecycleController.destroy()
            File(context.filesDir, "state.json").delete()
        }
    }

    private fun assertFailedBubbleOpenRetriesOnNextTap(failFactory: Boolean) {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 10_000L) { service, engine ->
            val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
            val webViews = ServiceDetachedWebViewFactory(context)
            val pet = serviceField(service, "webView") as WebView
            windows.petView = pet
            setServiceField(service, "windowManager", windows)
            installDetachedController(service, windows, webViews)
            if (failFactory) webViews.failCreate = true else windows.failAddCount = 1

            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
            assertEquals(0, windows.petBoundsTransitions)

            webViews.failCreate = false
            windows.failAddCount = 0

            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            assertEquals("BUBBLE", serviceField(service, "surfaceMode").toString())
            assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
            assertSame(pet, serviceField(service, "webView"))
            assertEquals(0, windows.petBoundsTransitions)
        }
    }

    private fun assertFailedBubbleRecoveryRetriesOnNextTap(failFactory: Boolean) {
        withDeadlineService(now = 10_000L, lookAwayDueAt = 10_000L) { service, engine ->
            val windows = CountingWindowManager(context.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
            val webViews = ServiceDetachedWebViewFactory(context)
            val pet = serviceField(service, "webView") as WebView
            windows.petView = pet
            setServiceField(service, "windowManager", windows)
            installDetachedController(service, windows, webViews)
            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            val failedView = webViews.created.single()
            if (failFactory) webViews.failCreate = true else windows.failAddCount = 1

            webViews.rendererGone(failedView)
            shadowOf(Looper.getMainLooper()).idle()

            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals("PET", serviceField(service, "surfaceMode").toString())
            assertNull(detachedController(service).activeSurface)
            assertSame(pet, serviceField(service, "webView"))
            assertEquals(0, windows.petBoundsTransitions)

            webViews.failCreate = false
            windows.failAddCount = 0

            assertEquals(OverlayTapAction.OPEN_REMINDER, service.handlePetSingleTap())
            assertEquals("BUBBLE", serviceField(service, "surfaceMode").toString())
            assertEquals(DetachedSurfaceMode.BUBBLE, detachedController(service).activeSurface?.mode)
            assertEquals(listOf("lookAway"), engine.pendingQueue())
            assertEquals(0, windows.petBoundsTransitions)
        }
    }

    private fun deadlineSettings(lookAwayDueAt: Long, drinkWaterDueAt: Long?): String {
        val settings = JSONObject(MEDIUM_SETTINGS)
        val reminders = settings.getJSONArray("reminders")
        reminders.getJSONObject(0)
            .put("enabled", true)
            .put("nextDueAt", lookAwayDueAt)
            .put("status", "scheduled")
        reminders.getJSONObject(1)
            .put("enabled", drinkWaterDueAt != null)
            .put("nextDueAt", drinkWaterDueAt ?: 2_700_000L)
            .put("status", if (drinkWaterDueAt != null) "scheduled" else "disabled")
        return settings.toString()
    }

    private fun interpreter() = OverlayGestureInterpreter(
        bounds = Bounds(widthDp = 400, heightDp = 800),
        geometry = OverlayGeometry(defaultSizeDp = 72),
        initialPlacement = OverlayPlacement(200, 300, 72, Attachment.Free),
        touchSlopDp = 8,
        doubleTapWindowMs = 250,
    )
}

private fun rendererGoneDetail() = object : android.webkit.RenderProcessGoneDetail() {
    override fun didCrash(): Boolean = false
    override fun rendererPriorityAtExit(): Int = 0
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

private class CountingWindowManager(
    private val delegate: WindowManager,
) : WindowManager by delegate {
    var boundsTransitions = 0
    var petBoundsTransitions = 0
    var detachedBoundsTransitions = 0
    var petView: View? = null
    var failRemove = false
    var failAddCount = 0
    var failUpdateCount = 0

    override fun addView(view: View, params: ViewGroup.LayoutParams) {
        if (failAddCount > 0) {
            failAddCount -= 1
            throw IllegalStateException("add failed")
        }
    }

    override fun removeViewImmediate(view: View) {
        if (failRemove) throw IllegalStateException("remove failed")
    }

    override fun updateViewLayout(view: View, params: ViewGroup.LayoutParams) {
        if (failUpdateCount > 0) {
            failUpdateCount -= 1
            throw IllegalStateException("update failed")
        }
        boundsTransitions += 1
        if (view === petView) petBoundsTransitions += 1 else detachedBoundsTransitions += 1
    }
}

private class ServiceDetachedWebViewFactory(
    private val context: Context,
) : DetachedWebViewFactory {
    val created = mutableListOf<ServiceRecordingWebView>()
    var failCreate = false
    private val bridges = IdentityHashMap<WebView, OverlayJavascriptBridge>()
    private val rendererCallbacks = IdentityHashMap<WebView, (WebView) -> Unit>()

    override fun create(
        mode: DetachedSurfaceMode,
        generation: Long,
        onRendererGone: (WebView) -> Unit,
        onMessage: (WebView, DetachedOverlayWebMessage) -> Unit,
    ): WebView {
        if (failCreate) throw IllegalStateException("factory failed")
        lateinit var view: ServiceRecordingWebView
        view = ServiceRecordingWebView(context)
        created += view
        bridges[view] = OverlayJavascriptBridge.forDetached { message -> onMessage(view, message) }
        rendererCallbacks[view] = onRendererGone
        return view
    }

    fun postMessage(view: WebView, message: String) {
        bridges.getValue(view).postMessage(message)
    }

    fun rendererGone(view: WebView) {
        rendererCallbacks.getValue(view)(view)
    }
}

private class ServiceRecordingWebView(context: Context) : WebView(context) {
    var destroyedByServiceTest = false

    override fun destroy() {
        destroyedByServiceTest = true
        super.destroy()
    }
}

private fun installDetachedController(
    service: PetOverlayService,
    windows: WindowManager,
    webViews: DetachedWebViewFactory,
) {
    detachedController(service).destroy()
    val controller = DetachedOverlaySurfaceController(
        context = service,
        windowManager = windows,
        handler = serviceField(service, "mainHandler") as Handler,
        screenBoundsProvider = { serviceField(service, "screenBounds") as Bounds },
        anchorProvider = { serviceField(service, "placement") as OverlayPlacement },
        snapshotProvider = { JSONObject().put("schemaVersion", 1) },
        webViewFactory = webViews,
        onAction = { action -> invokeDetachedAction(service, action) },
        onSurfaceLost = service::handleDetachedSurfaceLost,
    )
    setServiceField(service, "detachedSurfaceController", controller)
}

private data class PetLayoutSnapshot(
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int,
)

private fun WindowManager.LayoutParams.snapshot() = PetLayoutSnapshot(x, y, width, height)

private fun assertPetWindowExact(
    service: PetOverlayService,
    pet: WebView,
    layout: WindowManager.LayoutParams,
    expected: PetLayoutSnapshot,
) {
    assertSame(pet, serviceField(service, "webView"))
    assertSame(layout, serviceField(service, "layoutParams"))
    assertEquals(expected, layout.snapshot())
}

private fun detachedController(service: PetOverlayService): DetachedOverlaySurfaceController =
    serviceField(service, "detachedSurfaceController") as DetachedOverlaySurfaceController

private fun invokeGestureResult(service: PetOverlayService, result: OverlayGestureResult) {
    serviceMethod(service, "handleGestureResult", OverlayGestureResult::class.java).invoke(service, result)
}

private fun invokeDetachedAction(service: PetOverlayService, action: DetachedSurfaceAction) {
    serviceMethod(service, "handleDetachedSurfaceAction", DetachedSurfaceAction::class.java).invoke(service, action)
}

private fun invokeServiceNoArg(service: PetOverlayService, name: String): Any? =
    serviceMethod(service, name).invoke(service)

private fun serviceMethod(
    service: PetOverlayService,
    name: String,
    vararg parameterTypes: Class<*>,
): java.lang.reflect.Method {
    var type: Class<*>? = service.javaClass
    while (type != null) {
        runCatching { type.getDeclaredMethod(name, *parameterTypes) }.getOrNull()?.let {
            it.isAccessible = true
            return it
        }
        type = type.superclass
    }
    throw NoSuchMethodException(name)
}

private object NoOpReminderLiveTimer : ReminderLiveTimer {
    override fun schedule(delayMillis: Long, onWake: () -> Unit) = Unit
    override fun cancel() = Unit
}

private object NoOpReminderRecoveryScheduler : ReminderRecoveryScheduler {
    override fun schedule(triggerAtMillis: Long) = Unit
    override fun cancel() = Unit
    override fun setRecoveryEnabled(enabled: Boolean) = Unit
}

private fun setServiceField(service: PetOverlayService, name: String, value: Any?) {
    serviceFieldDefinition(service, name).set(service, value)
}

private fun serviceField(service: PetOverlayService, name: String): Any? =
    serviceFieldDefinition(service, name).get(service)

private fun serviceFieldDefinition(service: PetOverlayService, name: String): java.lang.reflect.Field {
    var type: Class<*>? = service.javaClass
    while (type != null) {
        runCatching { type.getDeclaredField(name) }.getOrNull()?.let {
            it.isAccessible = true
            return it
        }
        type = type.superclass
    }
    throw NoSuchFieldException(name)
}

private fun rendererSurface(mode: String, generation: Long): Any {
    val modeValue = rendererSurfaceMode(mode)
    val type = Class.forName("io.elevenlabs.codexpetpause.overlay.PetOverlayService\$OverlayRendererSurface")
    return type.declaredConstructors.single().apply { isAccessible = true }.newInstance(modeValue, generation)
}

private fun rendererSurfaceMode(mode: String): Any {
    val type = Class.forName("io.elevenlabs.codexpetpause.overlay.PetOverlayService\$SurfaceMode")
    return type.enumConstants.single { (it as Enum<*>).name == mode }
}

private fun rendererRecoveryService(activeReminder: Boolean = false): RecoveryPetOverlayService {
    val service = Robolectric.buildService(RecoveryPetOverlayService::class.java).create().get()
    setServiceField(
        service,
        "windowManager",
        NoOpWindowManager(ApplicationProvider.getApplicationContext<Context>().getSystemService(Context.WINDOW_SERVICE) as WindowManager),
    )
    if (activeReminder) {
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(ApplicationProvider.getApplicationContext<Context>().filesDir)
        setServiceField(service, "reminderEngine", object : io.elevenlabs.codexpetpause.reminders.ReminderEngine(coordinator) {
            override fun pendingQueue(): List<String> = listOf("lookAway")
        })
    }
    AndroidServiceLifecycle.forContext(ApplicationProvider.getApplicationContext()).start()
    service.onStartCommand(Intent(ApplicationProvider.getApplicationContext(), RecoveryPetOverlayService::class.java)
        .setAction(PetOverlayService.SHOW), 0, 1)
    return service
}

@Suppress("UNCHECKED_CAST")
private fun signalOverlayReady(factory: OverlayWebViewFactory) {
    val callback = factory.javaClass.getDeclaredField("onMessage").apply { isAccessible = true }.get(factory)
        as (OverlayWebMessage) -> Unit
    callback(OverlayWebMessage.Ready)
    shadowOf(Looper.getMainLooper()).idle()
}

private class RecoveryPetOverlayService : PetOverlayService() {
    override fun hasOverlayPermission(): Boolean = true
    override fun currentScreenBounds(): Bounds = Bounds(widthDp = 400, heightDp = 800)
}

private class FailingReconcilePetOverlayService : PetOverlayService() {
    override fun reconcileReminderEngine(): ReminderTransition =
        throw IllegalStateException("reconcile failed")
}

private class DisplayReflowPetOverlayService : PetOverlayService() {
    var testBounds = Bounds(widthDp = 400, heightDp = 800)

    override fun hasOverlayPermission(): Boolean = true
    override fun currentScreenBounds(): Bounds = testBounds
}

private class NoOpWindowManager(
    private val delegate: WindowManager,
) : WindowManager by delegate {
    override fun addView(view: View, params: ViewGroup.LayoutParams) = Unit
    override fun removeViewImmediate(view: View) = Unit
    override fun updateViewLayout(view: View, params: ViewGroup.LayoutParams) = Unit
}

private const val MEDIUM_SETTINGS = """{"schemaVersion":5,"locale":"en","onboardingComplete":false,"theme":"system","petSize":"medium","soundEnabled":false,"animationsEnabled":true,"affinity":0,"quietHours":{"enabled":false,"startMinutes":1320,"endMinutes":420},"runtime":{},"cat":{"name":"Momo"},"activePetId":"builtin-cat","petPosition":{"xRatio":0.82,"yRatio":0.72},"reminders":[{"id":"lookAway","kind":"preset","type":"lookAway","enabled":false,"intervalMinutes":20,"nextDueAt":1200000,"status":"disabled"},{"id":"drinkWater","kind":"preset","type":"drinkWater","enabled":false,"intervalMinutes":45,"nextDueAt":2700000,"status":"disabled"},{"id":"standUp","kind":"preset","type":"standUp","enabled":false,"intervalMinutes":60,"nextDueAt":3600000,"status":"disabled"},{"id":"takeBreak","kind":"preset","type":"takeBreak","enabled":false,"intervalMinutes":90,"nextDueAt":5400000,"status":"disabled"}]}"""
private const val LARGE_SETTINGS = """{"schemaVersion":5,"locale":"en","onboardingComplete":false,"theme":"system","petSize":"large","soundEnabled":false,"animationsEnabled":true,"affinity":0,"quietHours":{"enabled":false,"startMinutes":1320,"endMinutes":420},"runtime":{},"cat":{"name":"Momo"},"activePetId":"builtin-cat","petPosition":{"xRatio":0.82,"yRatio":0.72},"reminders":[{"id":"lookAway","kind":"preset","type":"lookAway","enabled":false,"intervalMinutes":20,"nextDueAt":1200000,"status":"disabled"},{"id":"drinkWater","kind":"preset","type":"drinkWater","enabled":false,"intervalMinutes":45,"nextDueAt":2700000,"status":"disabled"},{"id":"standUp","kind":"preset","type":"standUp","enabled":false,"intervalMinutes":60,"nextDueAt":3600000,"status":"disabled"},{"id":"takeBreak","kind":"preset","type":"takeBreak","enabled":false,"intervalMinutes":90,"nextDueAt":5400000,"status":"disabled"}]}"""
