package io.elevenlabs.codexpetpause.reminders

import android.app.NotificationManager
import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.bridge.AndroidStateFileSystem
import io.elevenlabs.codexpetpause.bridge.AndroidStateStore
import io.elevenlabs.codexpetpause.bridge.StateFileSystem
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
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
        val backupAlarm = RecordingBackupAlarm()
        val delivery = ReminderDeliveryScheduler(
            ReminderEngine(store, clock, eventIds),
            clock,
            liveTimer,
            backupAlarm,
        )

        delivery.reschedule { }

        assertEquals(2_000L, liveTimer.delayMillis)
        assertEquals(10_000L, backupAlarm.triggerAtMillis)
        assertTrue(backupAlarm.recoveryIsEnabled)

        delivery.stopLiveTimer()

        assertTrue(liveTimer.cancelled)
        assertEquals(10_000L, backupAlarm.triggerAtMillis)
        assertFalse(backupAlarm.cancelled)
    }

    @Test
    fun importedPetUsesSystemSoundAndApi33AddsRuntimePermission() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val factory = ReminderNotificationFactory(context)

        assertEquals(ReminderSound.SYSTEM, factory.soundFor(ReminderPet.IMPORTED_CODEX))
        assertEquals(ReminderSound.CAT, factory.soundFor(ReminderPet.BUILT_IN_CAT))
        assertFalse(factory.requiresRuntimePermission(32))
        assertTrue(factory.requiresRuntimePermission(33))
    }

    @Test
    fun immutableCatAndSystemChannelsUseDifferentNativeSounds() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val factory = ReminderNotificationFactory(context)
        factory.ensureChannels()
        val manager = context.getSystemService(NotificationManager::class.java)
        val cat = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.BUILT_IN_CAT))
        val system = manager.getNotificationChannel(factory.channelIdFor(ReminderPet.IMPORTED_CODEX))

        assertNotEquals(cat.id, system.id)
        assertNotEquals(Settings.System.DEFAULT_NOTIFICATION_URI, cat.sound)
        assertEquals(Settings.System.DEFAULT_NOTIFICATION_URI, system.sound)
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

private class RecordingBackupAlarm : ReminderBackupAlarm {
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
