package io.elevenlabs.codexpetpause.reminders

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.elevenlabs.codexpetpause.MainActivity
import io.elevenlabs.codexpetpause.R
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import org.json.JSONObject

internal enum class ReminderPet { BUILT_IN_CAT, IMPORTED_CODEX }
internal enum class ReminderSound { CAT, SYSTEM, SILENT }

internal class ReminderNotificationFactory(
    private val context: Context,
) : ReminderNotificationSink {
    private val manager = context.getSystemService(NotificationManager::class.java)

    fun soundFor(pet: ReminderPet, soundEnabled: Boolean = true): ReminderSound = when {
        !soundEnabled -> ReminderSound.SILENT
        pet == ReminderPet.BUILT_IN_CAT -> ReminderSound.CAT
        else -> ReminderSound.SYSTEM
    }

    fun channelIdFor(pet: ReminderPet, soundEnabled: Boolean = true): String = when (soundFor(pet, soundEnabled)) {
        ReminderSound.CAT -> CAT_CHANNEL_ID
        ReminderSound.SYSTEM -> SYSTEM_CHANNEL_ID
        ReminderSound.SILENT -> SILENT_CHANNEL_ID
    }

    fun requiresRuntimePermission(apiLevel: Int = Build.VERSION.SDK_INT): Boolean = apiLevel >= 33

    fun ensureChannels() {
        val audio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val catSound = Uri.parse("android.resource://${context.packageName}/${R.raw.cat_meow}")
        manager.createNotificationChannel(
            NotificationChannel(CAT_CHANNEL_ID, "Cat reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Break reminders with the built-in cat meow"
                setSound(catSound, audio)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(SYSTEM_CHANNEL_ID, "Pet reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Break reminders with the system notification sound"
                setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audio)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(SILENT_CHANNEL_ID, "Silent reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Break reminders without sound"
                setSound(null, null)
            },
        )
    }

    override fun notifyDue(snapshotJson: String, reminderId: String): Boolean {
        ensureChannels()
        if (!canPostNotifications()) return false
        manager.notify(REMINDER_NOTIFICATION_ID, buildDueNotification(snapshotJson, reminderId))
        return true
    }

    fun buildDueNotification(snapshotJson: String, reminderId: String): Notification {
        val snapshot = JSONObject(snapshotJson)
        val settings = JSONObject(snapshot.getString("settingsJson"))
        val reminder = requireNotNull(findReminder(settings, reminderId)) { "Unknown reminder: $reminderId" }
        val locale = settings.getString("locale")
        val pet = if (snapshot.getJSONObject("overlay").optJSONObject("activePet") == null) {
            ReminderPet.BUILT_IN_CAT
        } else {
            ReminderPet.IMPORTED_CODEX
        }
        return Notification.Builder(context, channelIdFor(pet, settings.optBoolean("soundEnabled", true)))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(if (locale == "zh-CN") "休息提醒" else "Break reminder")
            .setContentText(reminderCopy(reminder, locale))
            .setContentIntent(PendingIntent.getActivity(
                context,
                SETTINGS_REQUEST,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(false)
            .addAction(action(if (locale == "zh-CN") "打开提醒" else "Open", OPEN_REQUEST, PetOverlayService.OPEN_REMINDER))
            .addAction(action(if (locale == "zh-CN") "10 分钟后" else "Snooze 10 min", SNOOZE_REQUEST, PetOverlayService.SNOOZE_CURRENT))
            .addAction(action(if (locale == "zh-CN") "退出" else "Quit", QUIT_REQUEST, PetOverlayService.QUIT))
            .build()
    }

    override fun cancel() {
        manager.cancel(REMINDER_NOTIFICATION_ID)
    }

    private fun canPostNotifications(): Boolean {
        if (!manager.areNotificationsEnabled()) return false
        return !requiresRuntimePermission() || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private fun action(label: String, requestCode: Int, command: String): Notification.Action =
        Notification.Action.Builder(null, label, serviceIntent(requestCode, command)).build()

    private fun serviceIntent(requestCode: Int, command: String): PendingIntent = PendingIntent.getForegroundService(
        context,
        requestCode,
        Intent(context, PetOverlayService::class.java).setAction(command),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun findReminder(settings: JSONObject, id: String): JSONObject? {
        val reminders = settings.getJSONArray("reminders")
        return (0 until reminders.length()).map(reminders::getJSONObject).firstOrNull { it.getString("id") == id }
    }

    private fun reminderCopy(reminder: JSONObject, locale: String): String {
        if (reminder.getString("kind") == "custom") {
            val label = reminder.getString("label")
            return if (locale == "zh-CN") "我来提醒你：$label。" else "A little reminder from me: $label."
        }
        return if (locale == "zh-CN") ZH_COPY.getValue(reminder.getString("type"))
        else EN_COPY.getValue(reminder.getString("type"))
    }

    companion object {
        private const val CAT_CHANNEL_ID = "reminders-cat-v1"
        private const val SYSTEM_CHANNEL_ID = "reminders-system-v1"
        private const val SILENT_CHANNEL_ID = "reminders-silent-v1"
        private const val REMINDER_NOTIFICATION_ID = 5106
        private const val OPEN_REQUEST = 6101
        private const val SNOOZE_REQUEST = 6102
        private const val SETTINGS_REQUEST = 6104
        private const val QUIT_REQUEST = 6105
        private val ZH_COPY = mapOf(
            "lookAway" to "看屏幕很久啦，要不要看看远处？",
            "drinkWater" to "陪我去喝口水吧？",
            "standUp" to "起来伸个懒腰怎么样？",
            "takeBreak" to "休息一会儿，我在这里等你。",
        )
        private val EN_COPY = mapOf(
            "lookAway" to "You have been looking at the screen for a while. Want to look into the distance?",
            "drinkWater" to "Want to get a glass of water with me?",
            "standUp" to "How about standing up for a stretch?",
            "takeBreak" to "Take a little break. I will wait here.",
        )
    }
}
