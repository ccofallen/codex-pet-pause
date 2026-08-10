package io.elevenlabs.codexpetpause

import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import io.elevenlabs.codexpetpause.reminders.ReminderEngine
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RuntimeSynchronizationTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
        val now = System.currentTimeMillis()
        DeviceQa.seedState(reminders = JSONArray().apply {
            put(DeviceQa.reminder("lookAway", "lookAway", true, 1, now - 1_000L))
            put(DeviceQa.reminder("drinkWater", "drinkWater", false, 45, now + 2_700_000L))
            put(DeviceQa.reminder("standUp", "standUp", false, 60, now + 3_600_000L))
            put(DeviceQa.reminder("takeBreak", "takeBreak", false, 90, now + 5_400_000L))
        })
    }

    @After
    fun tearDown() {
        DeviceQa.stopService()
    }

    @Test
    fun overlayCompletionImmediatelyRefreshesMountedCompanion() {
        DeviceQa.setOverlayPermission(true)
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            DeviceQa.awaitText("Phone navigation", "手机导航")
            DeviceQa.clickText("Companion", "陪伴")
            DeviceQa.awaitCondition("companion page should mount") {
                DeviceQa.webText(scenario, "android-companion").isNotBlank()
            }

            val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
            val baselineRevision = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))
                .getLong("revision")
            DeviceQa.startService(PetOverlayService.START)
            val pet = DeviceQa.awaitPetWindow()
            DeviceQa.tap(android.graphics.Point(pet.bounds.centerX(), pet.bounds.centerY()))
            DeviceQa.awaitDetachedSurface(
                pet,
                "due reminder should open a measured detached BUBBLE from the real overlay",
                minimumWidth = DeviceQa.dp(120),
                minimumHeight = DeviceQa.dp(120),
            )
            DeviceQa.assertPetWindowStable(pet)

            val completionStartedAt = SystemClock.elapsedRealtime()
            DeviceQa.dispatchReminderActionThroughRenderer("complete")
            var countdown = 0L
            val remainingDeadline = (2_000L -
                (SystemClock.elapsedRealtime() - completionStartedAt)).coerceAtLeast(1L)
            DeviceQa.awaitCondition(
                "overlay completion did not refresh runtime history and mounted companion within two seconds",
                remainingDeadline,
            ) {
                val runtime = JSONObject(requireNotNull(coordinator.loadRuntimeSnapshot()))
                val history = runtime.getJSONArray("historyJson")
                val latestAction = if (history.length() == 0) null else
                    JSONObject(history.getString(history.length() - 1)).optString("action")
                val today = firstNumber(DeviceQa.webText(scenario, "android-today-summary"))
                countdown = remainingSeconds(DeviceQa.webText(scenario, "android-next-countdown"))
                runtime.getLong("revision") > baselineRevision &&
                    latestAction == "completed" && today == 1 && countdown > 0L
            }

            assertTrue("real overlay completion should restart a positive countdown", countdown > 0L)
            assertTrue(DeviceQa.webText(scenario, "android-companion").isNotBlank())
        }
    }

    @Test
    fun nativeActionsImmediatelyRestartCountdownAndUpdateTodayTotal() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            DeviceQa.awaitText("Phone navigation", "手机导航")
            DeviceQa.clickText("Companion", "陪伴")
            DeviceQa.awaitCondition("companion page should mount") {
                DeviceQa.webText(scenario, "android-companion").isNotBlank()
            }

            val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
            val engine = ReminderEngine(coordinator)
            engine.reconcile()

            engine.complete("lookAway")
            val completedCountdown = awaitUiRevision(scenario, expectedToday = 1, maximumSeconds = 90L)

            forceReminderDue(coordinator, "lookAway")
            engine.snooze("lookAway", System.currentTimeMillis() + 10 * 60_000L)
            val snoozedCountdown = awaitUiRevision(scenario, expectedToday = 1, minimumSeconds = 8 * 60L)

            forceReminderDue(coordinator, "lookAway")
            engine.skip("lookAway")
            val skippedCountdown = awaitUiRevision(scenario, expectedToday = 1, maximumSeconds = 90L)

            assertTrue("complete should restart a positive countdown", completedCountdown > 0L)
            assertTrue("snooze should publish its later deadline", snoozedCountdown > completedCountdown)
            assertTrue("the latest skip revision should replace the snooze deadline", skippedCountdown < snoozedCountdown)
        }
    }

    private fun awaitUiRevision(
        scenario: ActivityScenario<MainActivity>,
        expectedToday: Int,
        minimumSeconds: Long = 1L,
        maximumSeconds: Long = Long.MAX_VALUE,
    ): Long {
        var countdown = 0L
        DeviceQa.awaitCondition("runtime revision $expectedToday did not reach the companion within two seconds", 2_000L) {
            val today = firstNumber(DeviceQa.webText(scenario, "android-today-summary"))
            countdown = remainingSeconds(DeviceQa.webText(scenario, "android-next-countdown"))
            today == expectedToday && countdown in minimumSeconds..maximumSeconds
        }
        return countdown
    }

    private fun forceReminderDue(coordinator: AndroidStateCoordinator, id: String) {
        val snapshot = JSONObject(requireNotNull(coordinator.loadSnapshot()))
        val settings = JSONObject(snapshot.getString("settingsJson"))
        val reminders = settings.getJSONArray("reminders")
        val reminder = (0 until reminders.length())
            .map(reminders::getJSONObject)
            .single { it.getString("id") == id }
        reminder.put("status", "due").put("nextDueAt", System.currentTimeMillis() - 1_000L).remove("snoozedUntil")
        coordinator.saveReminderSettings(settings.toString())
    }

    private fun firstNumber(value: String): Int = Regex("[0-9]+").find(value)?.value?.toInt() ?: -1

    private fun remainingSeconds(value: String): Long {
        val values = Regex("[0-9]+").findAll(value).map { it.value.toLong() }.toList()
        if (values.isEmpty()) return 0L
        val lower = value.lowercase()
        return when {
            "hour" in lower -> values[0] * 3_600L + values.getOrElse(1) { 0L } * 60L
            "minute" in lower || " min" in lower -> values[0] * 60L + values.getOrElse(1) { 0L }
            else -> values[0]
        }
    }
}
