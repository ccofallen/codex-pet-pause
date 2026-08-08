package io.elevenlabs.codexpetpause.reminders

import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinator
import io.elevenlabs.codexpetpause.bridge.AndroidStateStore
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

internal fun interface ReminderClock {
    fun now(): Long
}

internal object SystemReminderClock : ReminderClock {
    override fun now(): Long = System.currentTimeMillis()
}

internal fun interface ReminderEventIdSource {
    fun next(now: Long): String
}

private object UuidReminderEventIdSource : ReminderEventIdSource {
    override fun next(now: Long): String = UUID.randomUUID().toString()
}

internal sealed interface ReminderTransition
internal data class ShowReminder(val reminderId: String) : ReminderTransition
internal data object CloseBubble : ReminderTransition

private data class QuietWindow(val start: Long, val end: Long)

private data class LoadedReminderState(
    val settings: JSONObject,
    val history: List<JSONObject>,
)

private data class QueuedReminder(
    val id: String,
    val dueAt: Long,
)

internal class ReminderEngine(
    private val coordinator: AndroidStateCoordinator,
    private val clock: ReminderClock,
    private val eventIds: ReminderEventIdSource,
) {
    constructor(
        store: AndroidStateStore,
        clock: ReminderClock = SystemReminderClock,
        eventIds: ReminderEventIdSource = UuidReminderEventIdSource,
    ) : this(AndroidStateCoordinator(store), clock, eventIds)

    constructor(
        coordinator: AndroidStateCoordinator,
        clock: ReminderClock = SystemReminderClock,
    ) : this(coordinator, clock, UuidReminderEventIdSource)

    fun reconcile(now: Long = clock.now()): ReminderTransition {
        val state = load() ?: return CloseBubble
        val original = state.settings.toString()
        repairFromHistory(state)
        settleSuppression(state.settings, now)

        val quietWindow = activeQuietWindow(now, state.settings.getJSONObject("quietHours"))
        val runtime = state.settings.getJSONObject("runtime")
        val pauseEnd = runtime.optLongOrNull("pausedUntil")
        val suppressed = quietWindow != null || (pauseEnd != null && pauseEnd > now)
        if (!suppressed) markDue(state.settings, now)

        if (state.settings.toString() != original) coordinator.saveReminderSettings(state.settings.toString())
        return transitionFor(state.settings)
    }

    fun snooze(id: String, until: Long): ReminderTransition {
        require(until > clock.now()) { "Snooze deadline must be in the future" }
        return applyAction(id, "snoozed") { reminder, _ ->
            reminder.put("status", "snoozed").put("snoozedUntil", until)
        }
    }

    fun complete(id: String): ReminderTransition = applyAction(id, "completed") { reminder, now ->
        scheduleNextInterval(reminder, now)
    }

    fun skip(id: String): ReminderTransition = applyAction(id, "skipped") { reminder, now ->
        scheduleNextInterval(reminder, now)
    }

    fun pendingQueue(): List<String> = load()?.settings?.let(::queueFor).orEmpty().map(QueuedReminder::id)

    fun delayUntilNext(): Long? {
        val settings = load()?.settings ?: return null
        val now = clock.now()
        val runtime = settings.getJSONObject("runtime")
        runtime.optLongOrNull("pausedUntil")?.let { pauseEnd ->
            if (pauseEnd > now) return pauseEnd - now
            return 0L
        }
        activeQuietWindow(now, settings.getJSONObject("quietHours"))?.let { return it.end - now }
        if (runtime.optLongOrNull("quietStartedAt") != null) return 0L

        val queued = queueFor(settings).map(QueuedReminder::id).toSet()
        val reminders = settings.getJSONArray("reminders")
        var next: Long? = null
        for (index in 0 until reminders.length()) {
            val reminder = reminders.getJSONObject(index)
            if (!reminder.getBoolean("enabled") || reminder.getString("id") in queued) continue
            val dueAt = effectiveDueAt(reminder)
            next = next?.let { minOf(it, dueAt) } ?: dueAt
        }
        return next?.let { (it - now).coerceAtLeast(0L) }
    }

    fun hasEnabledReminders(): Boolean {
        val reminders = load()?.settings?.getJSONArray("reminders") ?: return false
        return (0 until reminders.length()).any { reminders.getJSONObject(it).getBoolean("enabled") }
    }

    fun snapshotJson(): String? = coordinator.loadSnapshot()

    private fun applyAction(
        id: String,
        action: String,
        mutate: (JSONObject, Long) -> Unit,
    ): ReminderTransition {
        val state = requireNotNull(load()) { "Android reminder settings are unavailable" }
        val queue = queueFor(state.settings)
        require(queue.firstOrNull()?.id == id) { "Reminder is not current: $id" }
        val reminder = reminderById(state.settings, id)
        val now = clock.now()
        mutate(reminder, now)
        val event = JSONObject()
            .put("id", eventIds.next(now))
            .put("reminderId", id)
            .put("reminderLabel", reminderLabel(reminder, state.settings.getString("locale")))
            .put("action", action)
            .put("occurredAt", now)
        if (action == "snoozed") event.put("snoozedUntil", reminder.getLong("snoozedUntil"))
        if (reminder.getString("kind") == "preset") event.put("reminderType", reminder.getString("type"))
        coordinator.commitReminderAction(state.settings.toString(), event.toString())
        return transitionFor(state.settings)
    }

    private fun load(): LoadedReminderState? {
        val snapshot = coordinator.loadSnapshot()?.let(::JSONObject) ?: return null
        if (snapshot.isNull("settingsJson")) return null
        val historyValues = snapshot.getJSONArray("historyJson")
        return LoadedReminderState(
            settings = JSONObject(snapshot.getString("settingsJson")),
            history = (0 until historyValues.length()).map { JSONObject(historyValues.getString(it)) },
        )
    }

    private fun repairFromHistory(state: LoadedReminderState) {
        val latestSettled = mutableMapOf<String, Long>()
        state.history.forEach { event ->
            val action = event.optString("action")
            val reminderId = event.optString("reminderId")
            if (reminderId.isNotEmpty() && action in setOf("completed", "skipped")) {
                latestSettled[reminderId] = maxOf(latestSettled[reminderId] ?: Long.MIN_VALUE, event.getLong("occurredAt"))
            }
        }
        latestSettled.forEach { (id, occurredAt) ->
            val reminder = runCatching { reminderById(state.settings, id) }.getOrNull() ?: return@forEach
            val repairedDueAt = occurredAt + reminder.getInt("intervalMinutes") * MINUTE_MS
            if (repairedDueAt > reminder.getLong("nextDueAt")) {
                reminder.put("nextDueAt", repairedDueAt).put("status", if (reminder.getBoolean("enabled")) "scheduled" else "disabled")
                reminder.remove("snoozedUntil")
            }
        }
    }

    private fun settleSuppression(settings: JSONObject, now: Long) {
        val runtime = settings.getJSONObject("runtime")
        val reminders = settings.getJSONArray("reminders")
        val pausedAt = runtime.optLongOrNull("pausedAt")
        val pausedUntil = runtime.optLongOrNull("pausedUntil")
        if (pausedAt != null && pausedUntil != null && now >= pausedUntil) {
            shiftDueTimes(reminders, (pausedUntil - pausedAt).coerceAtLeast(0L))
            runtime.remove("pausedAt")
            runtime.remove("pausedUntil")
        }

        val quiet = settings.getJSONObject("quietHours")
        val active = activeQuietWindow(now, quiet)
        val quietStartedAt = runtime.optLongOrNull("quietStartedAt")
        if (active != null) {
            if (quietStartedAt == null) runtime.put("quietStartedAt", active.start)
            return
        }
        if (quietStartedAt != null) {
            val completedWindow = activeQuietWindow(quietStartedAt, quiet)
            val quietEnd = completedWindow?.end ?: now
            shiftDueTimes(reminders, (minOf(now, quietEnd) - quietStartedAt).coerceAtLeast(0L))
            runtime.remove("quietStartedAt")
        }
    }

    private fun markDue(settings: JSONObject, now: Long) {
        val reminders = settings.getJSONArray("reminders")
        for (index in 0 until reminders.length()) {
            val reminder = reminders.getJSONObject(index)
            if (!reminder.getBoolean("enabled")) {
                reminder.put("status", "disabled")
            } else if (effectiveDueAt(reminder) <= now) {
                reminder.put("status", "due")
            }
        }
    }

    private fun queueFor(settings: JSONObject): List<QueuedReminder> {
        val reminders = settings.getJSONArray("reminders")
        return (0 until reminders.length())
            .map(reminders::getJSONObject)
            .filter { it.getBoolean("enabled") && it.getString("status") == "due" }
            .map { QueuedReminder(it.getString("id"), effectiveDueAt(it)) }
            .sortedWith(compareBy(QueuedReminder::dueAt, QueuedReminder::id))
    }

    private fun transitionFor(settings: JSONObject): ReminderTransition =
        queueFor(settings).firstOrNull()?.let { ShowReminder(it.id) } ?: CloseBubble

    private fun reminderById(settings: JSONObject, id: String): JSONObject {
        val reminders = settings.getJSONArray("reminders")
        return (0 until reminders.length()).map(reminders::getJSONObject).firstOrNull { it.getString("id") == id }
            ?: throw IllegalArgumentException("Unknown reminder: $id")
    }

    private fun scheduleNextInterval(reminder: JSONObject, now: Long) {
        reminder
            .put("status", "scheduled")
            .put("nextDueAt", now + reminder.getInt("intervalMinutes") * MINUTE_MS)
            .remove("snoozedUntil")
    }

    private fun reminderLabel(reminder: JSONObject, locale: String): String {
        if (reminder.getString("kind") == "custom") return reminder.getString("label")
        val type = reminder.getString("type")
        return if (locale == "zh-CN") ZH_LABELS.getValue(type) else EN_LABELS.getValue(type)
    }

    companion object {
        private const val MINUTE_MS = 60_000L
        private val ZH_LABELS = mapOf(
            "lookAway" to "目视远方",
            "drinkWater" to "喝水",
            "standUp" to "起身活动",
            "takeBreak" to "休息一下",
        )
        private val EN_LABELS = mapOf(
            "lookAway" to "Look into the distance",
            "drinkWater" to "Drink water",
            "standUp" to "Stand up",
            "takeBreak" to "Take a break",
        )
    }
}

internal interface ReminderLiveTimer {
    fun schedule(delayMillis: Long, onWake: () -> Unit)
    fun cancel()
}

internal class CoroutineReminderLiveTimer(
    private val scope: CoroutineScope,
) : ReminderLiveTimer {
    private var job: Job? = null

    override fun schedule(delayMillis: Long, onWake: () -> Unit) {
        cancel()
        job = scope.launch {
            delay(delayMillis.coerceAtLeast(0L))
            onWake()
        }
    }

    override fun cancel() {
        job?.cancel()
        job = null
    }
}

internal interface ReminderRecoveryScheduler {
    fun schedule(triggerAtMillis: Long)
    fun cancel()
    fun setRecoveryEnabled(enabled: Boolean)
}

internal class ReminderDeliveryScheduler(
    private val engine: ReminderEngine,
    private val clock: ReminderClock,
    private val liveTimer: ReminderLiveTimer,
    private val backupAlarm: ReminderRecoveryScheduler,
) {
    fun reschedule(onWake: () -> Unit) {
        liveTimer.cancel()
        val enabled = engine.hasEnabledReminders()
        backupAlarm.setRecoveryEnabled(enabled)
        val delayMillis = if (enabled) engine.delayUntilNext() else null
        if (delayMillis == null) {
            backupAlarm.cancel()
            return
        }
        val triggerAt = clock.now() + delayMillis
        liveTimer.schedule(delayMillis, onWake)
        backupAlarm.schedule(triggerAt)
    }

    fun stopLiveTimer() {
        liveTimer.cancel()
    }

    fun cancelAll() {
        liveTimer.cancel()
        backupAlarm.cancel()
        backupAlarm.setRecoveryEnabled(false)
    }
}

private fun JSONObject.optLongOrNull(key: String): Long? =
    if (!has(key) || isNull(key)) null else getLong(key)

private fun effectiveDueAt(reminder: JSONObject): Long =
    reminder.optLongOrNull("snoozedUntil") ?: reminder.getLong("nextDueAt")

private fun shiftDueTimes(reminders: JSONArray, delta: Long) {
    if (delta <= 0L) return
    for (index in 0 until reminders.length()) {
        val reminder = reminders.getJSONObject(index)
        reminder.put("nextDueAt", reminder.getLong("nextDueAt") + delta)
        reminder.optLongOrNull("snoozedUntil")?.let { reminder.put("snoozedUntil", it + delta) }
    }
}

private fun activeQuietWindow(timestamp: Long, quiet: JSONObject): QuietWindow? {
    if (!quiet.getBoolean("enabled")) return null
    val startMinutes = quiet.getInt("startMinutes")
    val endMinutes = quiet.getInt("endMinutes")
    val zone = ZoneId.systemDefault()
    val local = Instant.ofEpochMilli(timestamp).atZone(zone)
    val minute = local.hour * 60 + local.minute
    val active = when {
        startMinutes < endMinutes -> minute >= startMinutes && minute < endMinutes
        startMinutes > endMinutes -> minute >= startMinutes || minute < endMinutes
        else -> true
    }
    if (!active) return null
    val startDate: LocalDate = if (startMinutes >= endMinutes && minute < endMinutes) {
        local.toLocalDate().minusDays(1)
    } else {
        local.toLocalDate()
    }
    val endDate = if (startMinutes >= endMinutes) startDate.plusDays(1) else startDate
    val start = startDate.atStartOfDay(zone).plusMinutes(startMinutes.toLong()).toInstant().toEpochMilli()
    val end = endDate.atStartOfDay(zone).plusMinutes(endMinutes.toLong()).toInstant().toEpochMilli()
    return QuietWindow(start, end)
}
