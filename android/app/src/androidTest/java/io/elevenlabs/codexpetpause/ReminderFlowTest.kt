package io.elevenlabs.codexpetpause

import android.app.NotificationManager
import android.app.job.JobScheduler
import android.content.Intent
import android.os.SystemClock
import android.provider.Settings
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import io.elevenlabs.codexpetpause.reminders.CloseBubble
import io.elevenlabs.codexpetpause.reminders.JobSchedulerReminderRecovery
import io.elevenlabs.codexpetpause.reminders.ReminderClock
import io.elevenlabs.codexpetpause.reminders.ReminderEngine
import io.elevenlabs.codexpetpause.reminders.ReminderNotificationFactory
import io.elevenlabs.codexpetpause.reminders.ReminderPet
import io.elevenlabs.codexpetpause.reminders.ReminderSound
import io.elevenlabs.codexpetpause.reminders.ShowReminder
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReminderFlowTest {
    @Before fun setUp() { DeviceQa.reset(); DeviceQa.grantNotifications(); DeviceQa.setOverlayPermission(true) }
    @After fun tearDown() = DeviceQa.stopService()

    @Test
    fun completionAdvancesThenClosesAndPersistsHistory() {
        val now = 10_000L
        DeviceQa.seedState(reminders = dueReminders(now))
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val engine = ReminderEngine(coordinator, ReminderClock { now })
        assertEquals(ShowReminder("drinkWater"), engine.reconcile(now))
        assertEquals(listOf("drinkWater", "lookAway"), engine.pendingQueue())
        assertEquals(ShowReminder("lookAway"), engine.complete("drinkWater"))
        assertEquals(CloseBubble, engine.complete("lookAway"))
        assertTrue(engine.pendingQueue().isEmpty())
        val history = JSONObject(requireNotNull(coordinator.loadSnapshot())).getJSONArray("historyJson")
        assertEquals(2, history.length())
        assertEquals(listOf("completed", "completed"), (0 until history.length()).map {
            JSONObject(history.getString(it)).getString("action")
        })
    }

    @Test
    fun builtInImportedAndSilentSettingsCreateDistinctNotificationChannels() {
        val factory = ReminderNotificationFactory(DeviceQa.context)
        factory.ensureChannels()
        assertEquals(ReminderSound.CAT, factory.soundFor(ReminderPet.BUILT_IN_CAT, true))
        assertEquals(ReminderSound.SYSTEM, factory.soundFor(ReminderPet.IMPORTED_CODEX, true))
        assertEquals(ReminderSound.SILENT, factory.soundFor(ReminderPet.BUILT_IN_CAT, false))
        val manager = DeviceQa.context.getSystemService(NotificationManager::class.java)
        val cat = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.BUILT_IN_CAT, true))
        val imported = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.IMPORTED_CODEX, true))
        val silent = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.IMPORTED_CODEX, false))
        assertNotEquals(cat.id, imported.id)
        assertNotEquals(imported.id, silent.id)
        assertTrue(cat.sound.toString().startsWith("android.resource://"))
        assertEquals(Settings.System.DEFAULT_NOTIFICATION_URI, imported.sound)
        assertEquals(null, silent.sound)
    }

    @Test
    fun activityCloseLeavesRecoveryRunningButQuitSuppressesBootAndJobRestart() {
        val now = System.currentTimeMillis()
        DeviceQa.seedState(reminders = futureReminder(now + 60_000L))
        DeviceQa.startService(PetOverlayService.START)
        DeviceQa.awaitOverlay()
        ActivityScenario.launch(MainActivity::class.java).use { DeviceQa.awaitText("Phone status", "手机状态") }
        assertTrue(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().serviceActive)
        assertTrue(DeviceQa.hasForegroundServiceNotification())

        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(DeviceQa.context.filesDir)
        val restored = ReminderEngine(coordinator, ReminderClock { now })
        assertEquals(60_000L, restored.delayUntilNext())
        JobSchedulerReminderRecovery(DeviceQa.context, ReminderClock { now }).apply {
            setRecoveryEnabled(true)
            schedule(now + requireNotNull(restored.delayUntilNext()))
        }
        assertTrue(DeviceQa.context.getSystemService(JobScheduler::class.java).allPendingJobs.isNotEmpty())

        PetOverlayService.requestQuit(DeviceQa.context)
        DeviceQa.awaitCondition("quit should suppress recovery") { !DeviceQa.hasForegroundServiceNotification() }
        assertFalse(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().recoveryAllowed)
        assertTrue(DeviceQa.context.getSystemService(JobScheduler::class.java).allPendingJobs.isEmpty())
        DeviceQa.context.sendBroadcast(Intent(Intent.ACTION_BOOT_COMPLETED))
        SystemClock.sleep(500)
        assertFalse(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().serviceActive)
    }

    private fun dueReminders(now: Long) = JSONArray().apply {
        put(DeviceQa.reminder("lookAway", "lookAway", true, 1, now - 2_000L))
        put(DeviceQa.reminder("drinkWater", "drinkWater", true, 1, now - 1_000L))
        put(DeviceQa.reminder("standUp", "standUp", false, 60, now + 60_000L))
        put(DeviceQa.reminder("takeBreak", "takeBreak", false, 90, now + 90_000L))
    }

    private fun futureReminder(dueAt: Long) = JSONArray().apply {
        put(DeviceQa.reminder("lookAway", "lookAway", true, 20, dueAt))
        put(DeviceQa.reminder("drinkWater", "drinkWater", false, 45, dueAt + 1))
        put(DeviceQa.reminder("standUp", "standUp", false, 60, dueAt + 2))
        put(DeviceQa.reminder("takeBreak", "takeBreak", false, 90, dueAt + 3))
    }
}
