package io.elevenlabs.codexpetpause.reminders

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import io.elevenlabs.codexpetpause.bridge.AndroidStateCoordinatorRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in RESTORATION_ACTIONS) return
        if (ReminderRecoveryEntryPoint(context).suppressAfterQuit()) return
        val coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        val engine = ReminderEngine(coordinator)
        val recovery = JobSchedulerReminderRecovery(context)
        if (!engine.hasEnabledReminders()) {
            recovery.apply {
                cancel()
                setRecoveryEnabled(false)
            }
            return
        }
        recovery.schedule(System.currentTimeMillis())
    }

    companion object {
        private val RESTORATION_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
        )

        fun setEnabled(context: Context, enabled: Boolean) {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context, BootReceiver::class.java),
                if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }
    }
}
