package io.elevenlabs.codexpetpause.reminders

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import io.elevenlabs.codexpetpause.bridge.AndroidStateStore
import io.elevenlabs.codexpetpause.overlay.PetOverlayService

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in RESTORATION_ACTIONS) return
        val engine = ReminderEngine(AndroidStateStore(context.filesDir))
        if (!engine.hasEnabledReminders()) {
            AlarmReminderBackup(context).apply {
                cancel()
                setRecoveryEnabled(false)
            }
            return
        }
        ContextCompat.startForegroundService(
            context,
            Intent(context, PetOverlayService::class.java).setAction(PetOverlayService.REMINDER_WAKE),
        )
    }

    companion object {
        const val ACTION_REMINDER_WAKE = "io.elevenlabs.codexpetpause.REMINDER_WAKE"
        private val RESTORATION_ACTIONS = setOf(
            ACTION_REMINDER_WAKE,
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
