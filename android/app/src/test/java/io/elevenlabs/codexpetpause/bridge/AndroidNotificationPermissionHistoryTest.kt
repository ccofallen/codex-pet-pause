package io.elevenlabs.codexpetpause.bridge

import android.content.Context
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidNotificationPermissionHistoryTest {
    @Test
    fun firstDismissalRemainsRetryable() {
        val history = freshHistory()
        history.recordResult(granted = false, shouldShowRationale = false)

        assertEquals(1, AndroidNotificationPermissionHistory(preferences()).promptCount())
        assertEquals(0, AndroidNotificationPermissionHistory(preferences()).denialCount())
        assertEquals(NotificationPermission.DENIED_CAN_ASK, state(history, granted = false))
    }

    @Test
    fun firstDenialRemainsRetryableAndRepeatedDenialRoutesToSettings() {
        val history = freshHistory()
        history.recordResult(granted = false, shouldShowRationale = true)
        assertEquals(1, history.denialCount())
        assertEquals(NotificationPermission.DENIED_CAN_ASK, state(history, granted = false))

        AndroidNotificationPermissionHistory(preferences()).recordResult(
            granted = false,
            shouldShowRationale = false,
        )
        assertEquals(2, history.denialCount())
        assertEquals(NotificationPermission.BLOCKED, state(history, granted = false))
    }

    @Test
    fun repeatedDismissalRemainsRetryable() {
        val history = freshHistory()
        history.recordResult(granted = false, shouldShowRationale = false)
        history.recordResult(granted = false, shouldShowRationale = false)

        assertEquals(2, history.promptCount())
        assertEquals(0, history.denialCount())
        assertEquals(NotificationPermission.DENIED_CAN_ASK, state(history, granted = false))
    }

    @Test
    fun grantResetsDenialHistoryAndReportsGranted() {
        val history = freshHistory()
        history.recordResult(granted = false, shouldShowRationale = true)
        history.recordResult(granted = false, shouldShowRationale = false)
        history.recordResult(granted = true, shouldShowRationale = false)

        assertEquals(0, AndroidNotificationPermissionHistory(preferences()).promptCount())
        assertEquals(0, AndroidNotificationPermissionHistory(preferences()).denialCount())
        assertEquals(NotificationPermission.GRANTED, state(history, granted = true))
    }

    private fun state(
        history: AndroidNotificationPermissionHistory,
        granted: Boolean,
    ): NotificationPermission = AndroidPermissionContract.evaluate(
        apiLevel = 33,
        overlayGranted = true,
        notificationsGranted = granted,
        notificationPromptCount = history.promptCount(),
        notificationDenialCount = history.denialCount(),
        shouldShowRationale = false,
    ).notificationPermission

    private fun freshHistory(): AndroidNotificationPermissionHistory =
        AndroidNotificationPermissionHistory(preferences()).also { it.reset() }

    private fun preferences(): SharedPreferences = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences("notification-permission-history-test", Context.MODE_PRIVATE)
}
