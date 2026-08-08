package io.elevenlabs.codexpetpause

import android.app.Notification
import android.app.NotificationManager
import android.app.job.JobScheduler
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
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
        val now = System.currentTimeMillis()
        DeviceQa.seedState(reminders = dueReminders(now))
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val scheduler = DeviceQa.context.getSystemService(JobScheduler::class.java)
        val manager = DeviceQa.context.getSystemService(NotificationManager::class.java)

        DeviceQa.startService(PetOverlayService.START)

        DeviceQa.awaitCondition("service-created reminder recovery job") {
            scheduler.allPendingJobs.isNotEmpty()
        }
        DeviceQa.awaitCondition("first reminder notification") {
            reminderText(manager)?.contains("Drink water", ignoreCase = true) == true
        }
        DeviceQa.awaitCondition("expanded reminder overlay") {
            DeviceQa.overlayWindows().singleOrNull()?.let {
                it.width() > DeviceQa.dp(72) && it.height() > DeviceQa.dp(72)
            } == true
        }

        DeviceQa.clickText("Done", "Complete", "完成")

        DeviceQa.awaitCondition("second reminder notification") {
            reminderText(manager)?.contains("distance", ignoreCase = true) == true
        }
        DeviceQa.awaitCondition("first completion persisted") {
            history(coordinator).length() == 1
        }
        assertTrue(
            DeviceQa.overlayWindows().single().let {
                it.width() > DeviceQa.dp(72) && it.height() > DeviceQa.dp(72)
            },
        )

        DeviceQa.clickText("Done", "Complete", "完成")

        DeviceQa.awaitCondition("final reminder closes") {
            reminderText(manager) == null &&
                DeviceQa.overlayWindows().singleOrNull()?.let {
                    it.width() == DeviceQa.dp(72) && it.height() == DeviceQa.dp(72)
                } == true
        }

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
    fun builtInImportedAndSilentSettingsCreateDistinctNotificationChannels() {
        val factory = ReminderNotificationFactory(DeviceQa.context)
        factory.ensureChannels()

        assertEquals(ReminderSound.CAT, factory.soundFor(ReminderPet.BUILT_IN_CAT, true))
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

        assertNotEquals(cat.id, imported.id)
        assertNotEquals(imported.id, silent.id)
        assertTrue(cat.sound.toString().startsWith("android.resource://"))
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
            DeviceQa.awaitText("Phone status", "手机状态")
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
