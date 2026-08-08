package io.elevenlabs.codexpetpause.reminders

import android.app.NotificationManager
import android.app.job.JobScheduler
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.MainActivity
import io.elevenlabs.codexpetpause.R
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.bridge.AndroidStateFileSystem
import io.elevenlabs.codexpetpause.bridge.AndroidStateStore
import io.elevenlabs.codexpetpause.bridge.StateFileSystem
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ReminderEngineTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    private var now = 8_000L
    private lateinit var fileSystem: CountingStateFileSystem
    private lateinit var store: AndroidStateStore
    private val clock = ReminderClock { now }
    private val eventIds = ReminderEventIdSource { timestamp -> "event-$timestamp" }

    @Before
    fun setUp() {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
        fileSystem = CountingStateFileSystem()
        store = AndroidStateStore(temporaryFolder.newFolder("state"), fileSystem)
    }

    @After
    fun tearDown() {
        TimeZone.setDefault(null)
    }

    @Test
    fun processRecoveryPreservesPersistedCountdown() {
        seed(reminders = reminders(lookAwayDueAt = 10_000L))

        val restored = ReminderEngine(store, clock, eventIds)

        assertEquals(2_000L, restored.delayUntilNext())
    }

    @Test
    fun reconcileRepairsAStaleCountdownFromPersistedHistory() {
        seed(
            reminders = reminders(lookAwayDueAt = 1_000L),
            history = JSONArray().put(activity("completed", 5_000L, "lookAway")),
        )

        val engine = ReminderEngine(store, clock, eventIds)
        engine.reconcile(now)

        assertEquals(57_000L, engine.delayUntilNext())
        assertEquals(65_000L, savedReminder("lookAway").getLong("nextDueAt"))
    }

    @Test
    fun completingCurrentReminderAdvancesOrClosesInDeterministicOrder() {
        now = 10_000L
        seed(reminders = reminders(lookAwayDueAt = 1_000L, drinkWaterDueAt = 1_000L))
        val engine = ReminderEngine(store, clock, eventIds)

        assertEquals(ShowReminder("drinkWater"), engine.reconcile(now))
        assertEquals(listOf("drinkWater", "lookAway"), engine.pendingQueue())
        assertEquals(ShowReminder("lookAway"), engine.complete("drinkWater"))
        assertEquals(CloseBubble, engine.complete("lookAway"))
        assertTrue(engine.pendingQueue().isEmpty())
    }

    @Test
    fun reminderActionsPersistSettingsAndHistoryTogetherInOneAtomicWrite() {
        now = 10_000L
        seed(reminders = reminders(lookAwayDueAt = 1_000L, drinkWaterDueAt = 2_000L))
        val engine = ReminderEngine(store, clock, eventIds)
        engine.reconcile(now)
        fileSystem.atomicWrites = 0

        assertEquals(ShowReminder("drinkWater"), engine.complete("lookAway"))

        assertEquals(1, fileSystem.atomicWrites)
        assertEquals("scheduled", savedReminder("lookAway").getString("status"))
        assertEquals(70_000L, savedReminder("lookAway").getLong("nextDueAt"))
        assertEquals("completed", savedHistory().getJSONObject(0).getString("action"))
    }

    @Test
    fun snoozeAndSkipPersistNativeHistoryAndAdvanceTheSameQueue() {
        now = 10_000L
        seed(reminders = reminders(lookAwayDueAt = 1_000L, drinkWaterDueAt = 2_000L))
        val engine = ReminderEngine(store, clock, eventIds)
        engine.reconcile(now)

        assertEquals(ShowReminder("drinkWater"), engine.snooze("lookAway", 25_000L))
        assertEquals("snoozed", savedReminder("lookAway").getString("status"))
        assertEquals(25_000L, savedReminder("lookAway").getLong("snoozedUntil"))
        assertEquals(CloseBubble, engine.skip("drinkWater"))
        assertEquals(listOf("snoozed", "skipped"), (0 until savedHistory().length()).map {
            savedHistory().getJSONObject(it).getString("action")
        })
    }

    @Test
    fun quietHoursAdvanceDeliveryToTheNextAllowedInstantAcrossRecovery() {
        now = Instant.parse("2026-08-08T22:00:00Z").toEpochMilli()
        seed(
            reminders = reminders(lookAwayDueAt = now),
            quietHours = JSONObject()
                .put("enabled", true)
                .put("startMinutes", 22 * 60)
                .put("endMinutes", 7 * 60),
        )
        val engine = ReminderEngine(store, clock, eventIds)

        assertEquals(CloseBubble, engine.reconcile(now))
        assertTrue(engine.pendingQueue().isEmpty())
        assertEquals(9 * 60 * 60 * 1_000L, engine.delayUntilNext())

        now = Instant.parse("2026-08-09T07:00:00Z").toEpochMilli()
        val restored = ReminderEngine(store, clock, eventIds)
        assertEquals(ShowReminder("lookAway"), restored.reconcile(now))
    }

    @Test
    fun liveTimerStopLeavesThePersistedRecoveryAlarmScheduled() {
        seed(reminders = reminders(lookAwayDueAt = 10_000L))
        val liveTimer = RecordingLiveTimer()
        val recovery = RecordingRecoveryScheduler()
        val delivery = ReminderDeliveryScheduler(
            ReminderEngine(store, clock, eventIds),
            clock,
            liveTimer,
            recovery,
        )

        delivery.reschedule { }

        assertEquals(2_000L, liveTimer.delayMillis)
        assertEquals(10_000L, recovery.triggerAtMillis)
        assertTrue(recovery.recoveryIsEnabled)

        delivery.stopLiveTimer()

        assertTrue(liveTimer.cancelled)
        assertEquals(10_000L, recovery.triggerAtMillis)
        assertFalse(recovery.cancelled)
    }

    @Test
    fun recoverySchedulesAPersistedJobServiceInsteadOfAnAlarmOrForegroundService() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val recovery = JobSchedulerReminderRecovery(context, clock)
        recovery.cancel()

        recovery.schedule(10_000L)

        val job = context.getSystemService(JobScheduler::class.java)
            .getPendingJob(JobSchedulerReminderRecovery.JOB_ID)
        assertNotNull(job)
        assertEquals(ReminderRecoveryJobService::class.java.name, job!!.service.className)
        assertTrue(job.isPersisted)
        assertEquals(2_000L, job.minLatencyMillis)
        assertEquals(
            2_000L + JobSchedulerReminderRecovery.MAX_RECOVERY_LATENESS_MILLIS,
            job.maxExecutionDelayMillis,
        )
        recovery.cancel()
    }

    @Test
    fun recoveryClampsDueNowAndPastDueJobsToTheSameBoundedGraceWindow() {
        now = 10_000L
        val context = ApplicationProvider.getApplicationContext<Context>()
        val recovery = JobSchedulerReminderRecovery(context, clock)
        val jobs = context.getSystemService(JobScheduler::class.java)
        recovery.cancel()

        recovery.schedule(10_000L)
        val dueNow = requireNotNull(jobs.getPendingJob(JobSchedulerReminderRecovery.JOB_ID))
        assertEquals(0L, dueNow.minLatencyMillis)
        assertEquals(
            JobSchedulerReminderRecovery.MAX_RECOVERY_LATENESS_MILLIS,
            dueNow.maxExecutionDelayMillis,
        )

        recovery.schedule(2_000L)
        val pastDue = requireNotNull(jobs.getPendingJob(JobSchedulerReminderRecovery.JOB_ID))
        assertEquals(0L, pastDue.minLatencyMillis)
        assertEquals(
            JobSchedulerReminderRecovery.MAX_RECOVERY_LATENESS_MILLIS,
            pastDue.maxExecutionDelayMillis,
        )
        recovery.cancel()
    }

    @Test
    fun bootRecoveryQueuesAJobWithoutStartingTheOverlayForegroundService() {
        seed(reminders = reminders(lookAwayDueAt = 10_000L))
        val context = ApplicationProvider.getApplicationContext<Context>()
        val contextStore = AndroidStateStore(context.filesDir)
        contextStore.writeSnapshot(store.readSnapshot()!!)
        val jobs = context.getSystemService(JobScheduler::class.java)
        jobs.cancel(JobSchedulerReminderRecovery.JOB_ID)
        val application = shadowOf(context.applicationContext as android.app.Application)
        while (application.nextStartedService != null) Unit

        BootReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))

        assertNull(application.nextStartedService)
        assertNotNull(jobs.getPendingJob(JobSchedulerReminderRecovery.JOB_ID))
        jobs.cancel(JobSchedulerReminderRecovery.JOB_ID)
        File(context.filesDir, "state.json").delete()
    }

    @Test
    fun processDeathRecoveryReconcilesPersistedStateAndPostsTheCurrentReminder() {
        now = 10_000L
        seed(reminders = reminders(lookAwayDueAt = 1_000L))
        val notifications = RecordingNotificationSink()
        val recovery = RecordingRecoveryScheduler()
        val dispatcher = ReminderRecoveryDispatcher(
            ReminderEngine(store, clock, eventIds),
            clock,
            notifications,
            recovery,
        )

        dispatcher.recover()

        assertEquals(listOf("cancel", "notify:lookAway"), notifications.calls)
        assertEquals("due", savedReminder("lookAway").getString("status"))
        assertTrue(recovery.recoveryIsEnabled)
    }

    @Test
    fun concurrentSettingsSaveAndReminderActionBothSurviveTheProcessBoundary() {
        now = 10_000L
        seed(reminders = reminders(lookAwayDueAt = 1_000L))
        val staleSettings = savedSettings().put("locale", "zh-CN").toString()
        val first = AndroidStateCoordinatorRegistry.forFilesDir(store.filesDir)
        val second = AndroidStateCoordinatorRegistry.forFilesDir(store.filesDir)
        assertSame(first, second)
        val engine = ReminderEngine(first, clock, eventIds)
        engine.reconcile(now)
        val start = CountDownLatch(1)
        val completed = thread {
            start.await()
            engine.complete("lookAway")
        }
        val saved = thread {
            start.await()
            second.saveSettings(staleSettings)
        }

        start.countDown()
        completed.join()
        saved.join()

        assertEquals("zh-CN", savedSettings().getString("locale"))
        assertEquals("scheduled", savedReminder("lookAway").getString("status"))
        assertEquals(70_000L, savedReminder("lookAway").getLong("nextDueAt"))
        assertEquals("completed", savedHistory().getJSONObject(0).getString("action"))
    }

    @Test
    fun staleCustomLabelRenameAfterSnoozePreservesCommittedRuntime() {
        now = 10_000L
        val configured = reminders(lookAwayDueAt = Long.MAX_VALUE)
            .put(custom("custom-eye", "Look away", 1_000L, 1))
        seed(reminders = configured)
        val staleRename = savedSettings()
        staleRename.getJSONArray("reminders").getJSONObject(4).put("label", "Rest your eyes")
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(store.filesDir)
        val engine = ReminderEngine(coordinator, clock, eventIds)
        val snoozedUntil = now + 10 * 60_000L
        val snoozed = CountDownLatch(1)

        engine.reconcile(now)
        val action = thread {
            engine.snooze("custom-eye", snoozedUntil)
            snoozed.countDown()
        }
        val rename = thread {
            snoozed.await()
            coordinator.saveSettings(staleRename.toString())
        }
        action.join()
        rename.join()

        val saved = savedReminder("custom-eye")
        assertEquals("Rest your eyes", saved.getString("label"))
        assertEquals("snoozed", saved.getString("status"))
        assertEquals(snoozedUntil, saved.getLong("snoozedUntil"))
    }

    @Test
    fun customLabelRenameBeforeSnoozeAlsoPreservesBothChanges() {
        now = 10_000L
        val configured = reminders(lookAwayDueAt = Long.MAX_VALUE)
            .put(custom("custom-eye", "Look away", 1_000L, 1))
        seed(reminders = configured)
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(store.filesDir)
        val engine = ReminderEngine(coordinator, clock, eventIds)
        engine.reconcile(now)
        val renamed = savedSettings()
        renamed.getJSONArray("reminders").getJSONObject(4).put("label", "Rest your eyes")
        val snoozedUntil = now + 10 * 60_000L
        val renamedFirst = CountDownLatch(1)

        val rename = thread {
            coordinator.saveSettings(renamed.toString())
            renamedFirst.countDown()
        }
        val action = thread {
            renamedFirst.await()
            engine.snooze("custom-eye", snoozedUntil)
        }
        rename.join()
        action.join()

        val saved = savedReminder("custom-eye")
        assertEquals("Rest your eyes", saved.getString("label"))
        assertEquals("snoozed", saved.getString("status"))
        assertEquals(snoozedUntil, saved.getLong("snoozedUntil"))
    }

    @Test
    fun scheduleChangingSaveUsesItsRecomputedDeadlineInsteadOfCommittedSnooze() {
        now = 10_000L
        val configured = reminders(lookAwayDueAt = Long.MAX_VALUE)
            .put(custom("custom-eye", "Look away", 1_000L, 1))
        seed(reminders = configured)
        val changedSchedule = savedSettings()
        changedSchedule.getJSONArray("reminders").getJSONObject(4)
            .put("label", "Rest your eyes")
            .put("intervalMinutes", 5)
            .put("status", "scheduled")
            .put("nextDueAt", now + 5 * 60_000L)
            .remove("snoozedUntil")
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(store.filesDir)
        val engine = ReminderEngine(coordinator, clock, eventIds)
        engine.reconcile(now)
        engine.snooze("custom-eye", now + 10 * 60_000L)

        coordinator.saveSettings(changedSchedule.toString())

        val saved = savedReminder("custom-eye")
        assertEquals("Rest your eyes", saved.getString("label"))
        assertEquals(5, saved.getInt("intervalMinutes"))
        assertEquals("scheduled", saved.getString("status"))
        assertEquals(now + 5 * 60_000L, saved.getLong("nextDueAt"))
        assertFalse(saved.has("snoozedUntil"))
    }

    @Test
    fun advancingQueueCancelsAndRepostsNotificationForTheNewCurrentReminder() {
        val notifications = RecordingNotificationSink()
        val dispatcher = ReminderQueueNotificationDispatcher(notifications)

        dispatcher.show("snapshot-b", "drinkWater")

        assertEquals(listOf("cancel", "notify:drinkWater"), notifications.calls)
    }

    @Test
    fun importedPetUsesSystemSoundAndApi33AddsRuntimePermission() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val factory = ReminderNotificationFactory(context)

        assertEquals(ReminderSound.SYSTEM, factory.soundFor(ReminderPet.IMPORTED_CODEX, soundEnabled = true))
        assertEquals(ReminderSound.CAT, factory.soundFor(ReminderPet.BUILT_IN_CAT, soundEnabled = true))
        assertEquals(ReminderSound.SILENT, factory.soundFor(ReminderPet.BUILT_IN_CAT, soundEnabled = false))
        assertFalse(factory.requiresRuntimePermission(32))
        assertTrue(factory.requiresRuntimePermission(33))
    }

    @Test
    fun immutableCatSystemAndSilentChannelsUseTheirIntendedNativeSounds() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val factory = ReminderNotificationFactory(context)
        factory.ensureChannels()
        val manager = context.getSystemService(NotificationManager::class.java)
        val cat = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.BUILT_IN_CAT, soundEnabled = true))
        val system = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.IMPORTED_CODEX, soundEnabled = true))
        val silent = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.BUILT_IN_CAT, soundEnabled = false))

        assertNotEquals(cat.id, system.id)
        assertNotEquals(cat.id, silent.id)
        assertNotEquals(Settings.System.DEFAULT_NOTIFICATION_URI, cat.sound)
        assertEquals(Settings.System.DEFAULT_NOTIFICATION_URI, system.sound)
        assertNull(silent.sound)
    }

    @Test
    fun reminderNotificationUsesContentSettingsAndAtMostThreeRoutedActions() {
        now = 10_000L
        seed(reminders = reminders(lookAwayDueAt = 1_000L))
        val context = ApplicationProvider.getApplicationContext<Context>()
        val notification = ReminderNotificationFactory(context)
            .buildDueNotification(store.readSnapshot()!!, "lookAway")

        assertEquals(MainActivity::class.java.name, shadowOf(notification.contentIntent).savedIntent.component!!.className)
        assertTrue(notification.actions.size <= 3)
        assertEquals(listOf("Open", "Snooze 10 min", "Quit"), notification.actions.map { it.title.toString() })
        assertEquals(
            listOf(PetOverlayService.OPEN_REMINDER, PetOverlayService.SNOOZE_CURRENT, PetOverlayService.QUIT),
            notification.actions.map { shadowOf(it.actionIntent).savedIntent.action },
        )
    }

    @Test
    fun catSoundCarriesDeterministicGeneratorProvenance() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val bytes = context.resources.openRawResource(R.raw.cat_meow).use { it.readBytes() }
        val payload = bytes.toString(Charsets.ISO_8859_1)

        assertTrue(payload.startsWith("RIFF"))
        assertTrue(payload.contains("Generated by scripts/generate-android-cat-meow.mjs"))
    }

    private fun seed(
        reminders: JSONArray,
        history: JSONArray = JSONArray(),
        quietHours: JSONObject = JSONObject()
            .put("enabled", false)
            .put("startMinutes", 22 * 60)
            .put("endMinutes", 7 * 60),
    ) {
        val settings = JSONObject()
            .put("schemaVersion", 5)
            .put("locale", "en")
            .put("onboardingComplete", true)
            .put("theme", "system")
            .put("petSize", "medium")
            .put("soundEnabled", true)
            .put("animationsEnabled", true)
            .put("affinity", 0)
            .put("quietHours", quietHours)
            .put("runtime", JSONObject())
            .put("cat", JSONObject().put("name", "Momo"))
            .put("activePetId", "builtin-cat")
            .put("petPosition", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))
            .put("reminders", reminders)
        val snapshot = JSONObject()
            .put("schemaVersion", 1)
            .put("settingsJson", settings.toString())
            .put("historyJson", history)
            .put("pets", JSONArray())
            .put("overlay", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))
        store.writeSnapshot(snapshot.toString())
    }

    private fun reminders(
        lookAwayDueAt: Long,
        drinkWaterDueAt: Long = Long.MAX_VALUE.toDouble().toLong(),
    ): JSONArray = JSONArray()
        .put(preset("lookAway", lookAwayDueAt, 1, true))
        .put(preset("drinkWater", drinkWaterDueAt, 45, drinkWaterDueAt != Long.MAX_VALUE))
        .put(preset("standUp", 60_000L, 60, false))
        .put(preset("takeBreak", 90_000L, 90, false))

    private fun preset(
        type: String,
        dueAt: Long,
        intervalMinutes: Int,
        enabled: Boolean,
    ) = JSONObject()
        .put("id", type)
        .put("kind", "preset")
        .put("type", type)
        .put("enabled", enabled)
        .put("intervalMinutes", intervalMinutes)
        .put("nextDueAt", dueAt)
        .put("status", if (enabled) "scheduled" else "disabled")

    private fun custom(
        id: String,
        label: String,
        dueAt: Long,
        intervalMinutes: Int,
    ) = JSONObject()
        .put("id", id)
        .put("kind", "custom")
        .put("label", label)
        .put("enabled", true)
        .put("intervalMinutes", intervalMinutes)
        .put("nextDueAt", dueAt)
        .put("status", "scheduled")

    private fun activity(action: String, occurredAt: Long, reminderId: String) = JSONObject()
        .put("id", "history-$occurredAt")
        .put("reminderId", reminderId)
        .put("action", action)
        .put("occurredAt", occurredAt)

    private fun savedSnapshot() = JSONObject(store.readSnapshot()!!)
    private fun savedSettings() = JSONObject(savedSnapshot().getString("settingsJson"))
    private fun savedHistory() = savedSnapshot().getJSONArray("historyJson").let { values ->
        JSONArray().also { parsed ->
            for (index in 0 until values.length()) parsed.put(JSONObject(values.getString(index)))
        }
    }
    private fun savedReminder(id: String): JSONObject = savedSettings().getJSONArray("reminders").let { values ->
        (0 until values.length()).map(values::getJSONObject).first { it.getString("id") == id }
    }
}

private class CountingStateFileSystem(
    private val delegate: StateFileSystem = AndroidStateFileSystem(),
) : StateFileSystem by delegate {
    var atomicWrites = 0

    override fun writeAtomically(file: File, value: String) {
        atomicWrites += 1
        delegate.writeAtomically(file, value)
    }
}

private class RecordingLiveTimer : ReminderLiveTimer {
    var delayMillis: Long? = null
    var cancelled = false

    override fun schedule(delayMillis: Long, onWake: () -> Unit) {
        this.delayMillis = delayMillis
        cancelled = false
    }

    override fun cancel() {
        cancelled = true
    }
}

private class RecordingRecoveryScheduler : ReminderRecoveryScheduler {
    var triggerAtMillis: Long? = null
    var recoveryIsEnabled = false
    var cancelled = false

    override fun schedule(triggerAtMillis: Long) {
        this.triggerAtMillis = triggerAtMillis
        cancelled = false
    }

    override fun cancel() {
        triggerAtMillis = null
        cancelled = true
    }

    override fun setRecoveryEnabled(enabled: Boolean) {
        recoveryIsEnabled = enabled
    }
}

private class RecordingNotificationSink : ReminderNotificationSink {
    val calls = mutableListOf<String>()

    override fun notifyDue(snapshotJson: String, reminderId: String): Boolean {
        calls += "notify:$reminderId"
        return true
    }

    override fun cancel() {
        calls += "cancel"
    }
}
