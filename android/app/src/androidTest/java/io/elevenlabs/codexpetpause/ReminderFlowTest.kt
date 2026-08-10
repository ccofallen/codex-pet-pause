package io.elevenlabs.codexpetpause

import android.app.Notification
import android.app.NotificationManager
import android.app.job.JobScheduler
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import io.elevenlabs.codexpetpause.overlay.DetachedOverlaySurfaceController
import io.elevenlabs.codexpetpause.overlay.DetachedSurfaceMode
import io.elevenlabs.codexpetpause.overlay.DetachedSurfaceWindowPhase
import io.elevenlabs.codexpetpause.overlay.PetOverlayDebugControls
import io.elevenlabs.codexpetpause.overlay.PetOverlayDebugHooks
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import io.elevenlabs.codexpetpause.reminders.ReminderNotificationFactory
import io.elevenlabs.codexpetpause.reminders.ReminderPet
import io.elevenlabs.codexpetpause.reminders.ReminderSound
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReminderFlowTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
        DeviceQa.setOverlayPermission(true)
        DeviceQa.context.getSystemService(JobScheduler::class.java).cancelAll()
    }

    @After
    fun tearDown() {
        DeviceQa.stopService()
    }

    @Test
    fun serviceCommandAndRendererActionAdvanceThenCloseAndPersistHistory() {
        val now = 1_000_000L
        val controls = PetOverlayDebugHooks.install(now)
        DeviceQa.seedState(reminders = dueReminders(now))
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val manager = DeviceQa.context.getSystemService(NotificationManager::class.java)

        DeviceQa.startService(PetOverlayService.START)

        val pet = DeviceQa.awaitPetWindow()
        controls.clearPetLayoutMutations()
        controls.clearDetachedSurfaceWindowEvents()

        DeviceQa.awaitCondition("first reminder notification") {
            reminderText(manager)?.contains("distance", ignoreCase = true) == true
        }
        DeviceQa.awaitCondition("due reminder waits behind the pet") {
            DeviceQa.detachedWindows(pet.id).isEmpty()
        }
        DeviceQa.tap(android.graphics.Point(pet.bounds.centerX(), pet.bounds.centerY()))
        val firstBubble = DeviceQa.awaitDetachedSurface(
            pet,
            "detached reminder renderer did not apply its real measurement",
            minimumWidth = DeviceQa.dp(120),
            minimumHeight = DeviceQa.dp(120),
        )
        DeviceQa.assertPetWindowStable(pet)
        assertEquals(2, DeviceQa.overlayWindowRecords().size)
        assertMeasuredBubbleTransition(controls)
        DeviceQa.dispatchReminderActionThroughRenderer("complete")

        DeviceQa.awaitCondition("second reminder notification") {
            reminderText(manager)?.contains("water", ignoreCase = true) == true
        }
        DeviceQa.awaitCondition("first completion persisted") {
            history(coordinator).length() == 1
        }
        assertTrue("held recovery scheduler did not receive an enabled request", true in controls.heldRecoveryEnabledRequests())
        assertTrue("held recovery scheduler did not receive a deterministic schedule request", controls.heldRecoveryScheduleRequests().isNotEmpty())
        val secondBubble = DeviceQa.awaitDetachedSurface(
            pet,
            "next pending reminder did not replace the detached bubble",
            minimumWidth = DeviceQa.dp(120),
            minimumHeight = DeviceQa.dp(120),
        )
        assertNotEquals(firstBubble.id, secondBubble.id)
        DeviceQa.assertPetWindowStable(pet)
        assertEquals(2, DeviceQa.overlayWindowRecords().size)

        DeviceQa.dispatchReminderActionThroughRenderer("complete")

        DeviceQa.awaitPetStableWhile(pet, "final reminder did not close") { snapshot ->
            reminderText(manager) == null &&
                snapshot.detachedWindows(pet.id).isEmpty()
        }
        DeviceQa.assertPetWindowStable(pet)
        assertEquals(1, DeviceQa.overlayWindowRecords().size)
        assertTrue("BUBBLE advance/close mutated pet layout", controls.petLayoutMutations().isEmpty())

        val persisted = history(coordinator)
        assertEquals(2, persisted.length())
        assertEquals(
            listOf("completed", "completed"),
            (0 until persisted.length()).map {
                JSONObject(persisted.getString(it)).getString("action")
            },
        )
    }

    @Test
    fun exactDeadlineDoesNotAutoOpenAndTapOpensMeasuredBubbleWithoutMovingPet() {
        val now = 2_000_000L
        val deadline = now + 1_000L
        val controls = PetOverlayDebugHooks.install(now)
        DeviceQa.seedState(reminders = exactDeadlineReminder(deadline))
        DeviceQa.startService(PetOverlayService.START)
        val pet = DeviceQa.awaitPetWindow()

        assertTrue("service did not schedule the held live timer", controls.heldLiveScheduleCount() > 0)
        assertEquals(0, controls.heldLiveWakeCount())
        controls.clearPetLayoutMutations()
        controls.clearDetachedSurfaceWindowEvents()
        controls.advanceClockTo(deadline)
        DeviceQa.assertPetWindowStable(pet)
        assertTrue("deadline reconciliation must not auto-open BUBBLE", DeviceQa.detachedWindows(pet.id).isEmpty())

        DeviceQa.tap(android.graphics.Point(pet.bounds.centerX(), pet.bounds.centerY()))
        DeviceQa.awaitDetachedSurface(
            pet,
            "tap at the reached deadline did not open a measured BUBBLE",
            minimumWidth = DeviceQa.dp(120),
            minimumHeight = DeviceQa.dp(120),
        )
        assertMeasuredBubbleTransition(controls)
        DeviceQa.assertPetWindowStable(pet)
        assertEquals(2, DeviceQa.overlayWindowRecords().size)

        val service = requireNotNull(PetOverlayService.activeDebugInstance)
        val controller = DeviceQa.privateField<DetachedOverlaySurfaceController>(
            service,
            "detachedSurfaceController",
        )
        val failedSurface = DeviceQa.activeDetachedWebView(controller)
        val failedRecord = DeviceQa.detachedWindows(pet.id).single()
        DeviceQa.onMain {
            assertTrue(
                failedSurface.webViewClient.onRenderProcessGone(
                    failedSurface,
                    DeviceQa.rendererGoneDetail(),
                ),
            )
        }
        DeviceQa.awaitDetachedReplacement(pet, failedRecord.id)
        DeviceQa.assertPetWindowStable(pet)
        assertTrue("BUBBLE renderer recovery touched the pet window", controls.petLayoutMutations().isEmpty())

        DeviceQa.dispatchReminderActionThroughRenderer("complete")
        DeviceQa.awaitPetStableWhile(pet, "completing the only pending reminder did not close BUBBLE") { snapshot ->
            snapshot.detachedWindows(pet.id).isEmpty()
        }
        DeviceQa.assertPetWindowStable(pet)
        assertEquals(1, DeviceQa.overlayWindowRecords().size)
        assertEquals(0, controls.heldLiveWakeCount())
        assertTrue("exact-deadline BUBBLE mutated pet layout", controls.petLayoutMutations().isEmpty())
    }

    @Test
    fun measuredBubbleCyclesTenTimesOnBothEdgesWithCompleteSkipAndSnooze() {
        listOf(false, true).forEachIndexed { edgeIndex, rightEdge ->
            DeviceQa.reset()
            DeviceQa.grantNotifications()
            DeviceQa.setOverlayPermission(true)
            DeviceQa.context.getSystemService(JobScheduler::class.java).cancelAll()
            val base = 10_000_000L + edgeIndex * 1_000_000L
            val controls = PetOverlayDebugHooks.install(base)
            DeviceQa.seedState(reminders = staggeredReminders(base))
            DeviceQa.startService(PetOverlayService.START)
            val pet = DeviceQa.anchorPetAtSafeEdge(rightEdge)

            repeat(10) { cycle ->
                controls.advanceClockTo(base + (cycle + 1L) * 1_000L)
                controls.clearPetLayoutMutations()
                controls.clearDetachedSurfaceWindowEvents()
                DeviceQa.assertPetWindowStable(pet)
                assertTrue(DeviceQa.detachedWindows(pet.id).isEmpty())

                DeviceQa.tap(android.graphics.Point(pet.bounds.centerX(), pet.bounds.centerY()))
                val opened = DeviceQa.awaitDetachedSurface(
                    pet,
                    "BUBBLE did not open on cycle $cycle at ${if (rightEdge) "RIGHT" else "LEFT"}",
                    minimumWidth = 1,
                    minimumHeight = 1,
                )
                val measured = DeviceQa.awaitDetachedSurface(
                    pet,
                    "BUBBLE did not apply real measurement on cycle $cycle",
                    minimumWidth = DeviceQa.dp(120),
                    minimumHeight = DeviceQa.dp(120),
                )
                assertEquals(opened.id, measured.id)
                assertMeasuredBubbleTransition(controls)
                DeviceQa.assertPetWindowStable(pet)
                assertEquals(2, DeviceQa.overlayWindowRecords().size)

                when (cycle % 3) {
                    0 -> {
                        DeviceQa.dispatchReminderActionThroughRenderer("complete")
                    }
                    1 -> DeviceQa.dispatchReminderActionThroughRenderer("skip")
                    else -> DeviceQa.dispatchReminderActionThroughRenderer("snooze", snoozeMinutes = 5)
                }
                DeviceQa.awaitPetStableWhile(pet, "BUBBLE did not close on cycle $cycle") { snapshot ->
                    snapshot.detachedWindows(pet.id).isEmpty()
                }
                DeviceQa.assertPetWindowStable(pet)
                assertEquals(1, DeviceQa.overlayWindowRecords().size)
                assertTrue(
                    "BUBBLE cycle $cycle mutated pet layout: ${controls.petLayoutMutations()}",
                    controls.petLayoutMutations().isEmpty(),
                )
            }

            val persisted = history(AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir))
            val actions = (0 until persisted.length()).map { index ->
                JSONObject(persisted.getString(index)).getString("action")
            }
            assertEquals(
                List(10) { cycle ->
                    when (cycle % 3) {
                        0 -> "completed"
                        1 -> "skipped"
                        else -> "snoozed"
                    }
                },
                actions,
            )
        }
    }

    @Test
    fun builtInAndImportedPetsUseSystemChannelWhileSilentRemainsDistinct() {
        val factory = ReminderNotificationFactory(DeviceQa.context)
        factory.ensureChannels()

        assertEquals(ReminderSound.SYSTEM, factory.soundFor(ReminderPet.BUILT_IN_CAT, true))
        assertEquals(ReminderSound.SYSTEM, factory.soundFor(ReminderPet.IMPORTED_CODEX, true))
        assertEquals(ReminderSound.SILENT, factory.soundFor(ReminderPet.BUILT_IN_CAT, false))

        val manager = DeviceQa.context.getSystemService(NotificationManager::class.java)
        val cat = manager.getNotificationChannel(
            factory.channelIdFor(ReminderPet.BUILT_IN_CAT, true),
        )
        val imported = manager.getNotificationChannel(
            factory.channelIdFor(ReminderPet.IMPORTED_CODEX, true),
        )
        val silent = manager.getNotificationChannel(
            factory.channelIdFor(ReminderPet.IMPORTED_CODEX, false),
        )

        assertEquals(cat.id, imported.id)
        assertNotEquals(imported.id, silent.id)
        assertEquals(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, cat.sound)
        assertEquals(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, imported.sound)
        assertNull(silent.sound)
    }

    @Test
    fun closingActivityLeavesServiceAndRecoveryRunningWhileQuitSuppressesRestart() {
        val now = System.currentTimeMillis()
        DeviceQa.seedState(reminders = futureReminder(now))
        val scheduler = DeviceQa.context.getSystemService(JobScheduler::class.java)

        DeviceQa.startService(PetOverlayService.START)
        ActivityScenario.launch(MainActivity::class.java).use { activity ->
            DeviceQa.awaitText("Phone navigation", "手机导航")
            activity.close()
        }

        DeviceQa.awaitCondition("service stays foreground after Activity close") {
            DeviceQa.hasForegroundServiceNotification() && scheduler.allPendingJobs.isNotEmpty()
        }

        DeviceQa.startService(PetOverlayService.QUIT)
        DeviceQa.awaitCondition("quit removes foreground service") {
            !DeviceQa.hasForegroundServiceNotification()
        }

        val attempted = AtomicBoolean(false)
        val restarted = AndroidServiceLifecycle.forContext(DeviceQa.context)
            .runRecoveryIfAllowed { attempted.set(true) }
        assertFalse(restarted)
        assertFalse(attempted.get())
    }

    private fun dueReminders(now: Long) = JSONArray().apply {
        put(DeviceQa.reminder("lookAway", "lookAway", true, 1, now - 2_000))
        put(DeviceQa.reminder("drinkWater", "drinkWater", true, 1, now - 1_000))
        put(DeviceQa.reminder("standUp", "standUp", false, 60, now + 60_000))
        put(DeviceQa.reminder("takeBreak", "takeBreak", false, 90, now + 90_000))
    }

    private fun futureReminder(now: Long) = JSONArray().apply {
        put(DeviceQa.reminder("drinkWater", "drinkWater", true, 1, now + 60_000))
        put(DeviceQa.reminder("lookAway", "lookAway", false, 20, now + 1_200_000))
        put(DeviceQa.reminder("standUp", "standUp", false, 60, now + 3_600_000))
        put(DeviceQa.reminder("takeBreak", "takeBreak", false, 90, now + 5_400_000))
    }

    private fun exactDeadlineReminder(deadline: Long) = JSONArray().apply {
        put(DeviceQa.reminder("lookAway", "lookAway", true, 1, deadline))
        put(DeviceQa.reminder("drinkWater", "drinkWater", false, 45, deadline + 2_700_000L))
        put(DeviceQa.reminder("standUp", "standUp", false, 60, deadline + 3_600_000L))
        put(DeviceQa.reminder("takeBreak", "takeBreak", false, 90, deadline + 5_400_000L))
    }

    private fun staggeredReminders(base: Long) = JSONArray().apply {
        listOf("lookAway", "drinkWater", "standUp", "takeBreak").forEachIndexed { index, type ->
            put(DeviceQa.reminder(type, type, true, 30, base + (index + 1L) * 1_000L))
        }
        repeat(6) { index ->
            put(
                JSONObject()
                    .put("id", "task6-custom-$index")
                    .put("kind", "custom")
                    .put("label", "Task 6 custom ${index + 1}")
                    .put("enabled", true)
                    .put("intervalMinutes", 30)
                    .put("nextDueAt", base + (index + 5L) * 1_000L)
                    .put("status", "scheduled"),
            )
        }
    }

    private fun assertMeasuredBubbleTransition(controls: PetOverlayDebugControls) {
        val events = controls.detachedSurfaceWindowEvents()
        val attachedIndex = events.indexOfFirst {
            it.phase == DetachedSurfaceWindowPhase.ATTACHED &&
                it.mode == DetachedSurfaceMode.BUBBLE &&
                it.widthDp == 1 && it.heightDp == 1 && !it.touchable
        }
        assertTrue("missing initial non-touchable 1x1 BUBBLE attachment: $events", attachedIndex >= 0)
        val attached = events[attachedIndex]
        val measuredIndex = events.indexOfFirst { event ->
            event.phase == DetachedSurfaceWindowPhase.LAYOUT_UPDATED &&
                event.mode == DetachedSurfaceMode.BUBBLE &&
                event.generation == attached.generation &&
                event.viewIdentity == attached.viewIdentity &&
                event.widthDp > 1 && event.heightDp > 1 && event.touchable
        }
        assertTrue(
            "missing ordered measured/touchable BUBBLE transition for $attached: $events",
            measuredIndex > attachedIndex,
        )
    }

    private fun history(coordinator: AndroidStateCoordinator): JSONArray {
        return JSONObject(requireNotNull(coordinator.loadSnapshot())).getJSONArray("historyJson")
    }

    private fun reminderText(manager: NotificationManager): String? {
        return manager.activeNotifications
            .asSequence()
            .map { it.notification }
            .firstOrNull {
                it.flags and Notification.FLAG_FOREGROUND_SERVICE == 0
            }
            ?.extras
            ?.getCharSequence(Notification.EXTRA_TEXT)
            ?.toString()
    }
}
