package io.elevenlabs.codexpetpause.reminders

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject

internal class JobSchedulerReminderRecovery(
    context: Context,
    private val clock: ReminderClock = SystemReminderClock,
) : ReminderRecoveryScheduler {
    private val applicationContext = context.applicationContext
    private val jobs = applicationContext.getSystemService(JobScheduler::class.java)

    override fun schedule(triggerAtMillis: Long) {
        if (ReminderRecoveryEntryPoint(applicationContext).suppressAfterQuit()) return
        val minimumLatency = (triggerAtMillis - clock.now()).coerceAtLeast(0L)
        val overrideDeadline = minimumLatency.saturatingAdd(MAX_RECOVERY_LATENESS_MILLIS)
        val job = JobInfo.Builder(
            JOB_ID,
            ComponentName(applicationContext, ReminderRecoveryJobService::class.java),
        )
            .setMinimumLatency(minimumLatency)
            .setOverrideDeadline(overrideDeadline)
            .setPersisted(true)
            .build()
        check(jobs.schedule(job) == JobScheduler.RESULT_SUCCESS) {
            "Unable to schedule reminder recovery"
        }
    }

    override fun cancel() {
        jobs.cancel(JOB_ID)
    }

    override fun setRecoveryEnabled(enabled: Boolean) {
        BootReceiver.setEnabled(applicationContext, enabled)
    }

    companion object {
        const val JOB_ID = 51_006

        /**
         * Gives JobScheduler meaningful batching flexibility while bounding
         * recovery to fifteen minutes after the persisted reminder due time.
         */
        const val MAX_RECOVERY_LATENESS_MILLIS = 15 * 60_000L
    }
}

internal class ReminderRecoveryEntryPoint(
    private val context: Context,
) {
    fun suppressAfterQuit(): Boolean {
        if (AndroidServiceLifecycle.forContext(context).snapshot().recoveryAllowed) return false
        JobSchedulerReminderRecovery(context).apply {
            cancel()
            setRecoveryEnabled(false)
        }
        return true
    }
}

private fun Long.saturatingAdd(value: Long): Long =
    if (this > Long.MAX_VALUE - value) Long.MAX_VALUE else this + value

internal interface ReminderNotificationSink {
    fun notifyDue(snapshotJson: String, reminderId: String): Boolean
    fun cancel()
}

internal class ReminderQueueNotificationDispatcher(
    private val notifications: ReminderNotificationSink,
) {
    fun show(snapshotJson: String, reminderId: String) {
        notifications.cancel()
        notifications.notifyDue(snapshotJson, reminderId)
    }
}

internal class ReminderRecoveryDispatcher(
    private val engine: ReminderEngine,
    private val clock: ReminderClock,
    private val notifications: ReminderNotificationSink,
    private val recovery: ReminderRecoveryScheduler,
) {
    fun recover() {
        val now = clock.now()
        engine.reconcile(now)
        val snapshot = engine.snapshotJson()
        val current = snapshot?.let(::currentReminderId)
        if (snapshot != null && current != null) {
            ReminderQueueNotificationDispatcher(notifications).show(snapshot, current)
        }

        val enabled = engine.hasEnabledReminders()
        recovery.setRecoveryEnabled(enabled)
        val delay = if (enabled) engine.delayUntilNext() else null
        if (delay == null) recovery.cancel() else recovery.schedule(now + delay)
    }

    private fun currentReminderId(snapshotJson: String): String? {
        val snapshot = JSONObject(snapshotJson)
        if (snapshot.isNull("settingsJson")) return null
        val reminders = JSONObject(snapshot.getString("settingsJson")).getJSONArray("reminders")
        return (0 until reminders.length())
            .map(reminders::getJSONObject)
            .filter { it.optBoolean("enabled") && it.optString("status") == "due" }
            .minWithOrNull(compareBy<JSONObject>({
                if (it.has("snoozedUntil")) it.getLong("snoozedUntil") else it.getLong("nextDueAt")
            }, { it.getString("id") }))
            ?.getString("id")
    }
}

class ReminderRecoveryJobService : JobService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var running: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        if (ReminderRecoveryEntryPoint(this).suppressAfterQuit()) return false
        running = scope.launch {
            val clock = SystemReminderClock
            val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(filesDir)
            val engine = ReminderEngine(coordinator, clock)
            val recovery = JobSchedulerReminderRecovery(this@ReminderRecoveryJobService, clock)
            ReminderRecoveryDispatcher(
                engine,
                clock,
                ReminderNotificationFactory(this@ReminderRecoveryJobService),
                recovery,
            ).recover()
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        running?.cancel()
        running = null
        return true
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
