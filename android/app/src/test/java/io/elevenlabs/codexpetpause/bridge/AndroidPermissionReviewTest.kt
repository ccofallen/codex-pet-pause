package io.elevenlabs.codexpetpause.bridge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AndroidPermissionReviewTest {
    private lateinit var history: AndroidNotificationPermissionHistory

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences("task9-permission-review", Context.MODE_PRIVATE)
        preferences.edit().clear().commit()
        history = AndroidNotificationPermissionHistory(preferences)
    }

    @Test
    fun dismissedPromptLeavesNotificationPermissionRequestable() {
        val capabilities = AndroidPermissionContract.evaluate(
            33,
            true,
            false,
            history.promptCount(),
            history.denialCount(),
            false,
        )

        assertEquals(0, history.promptCount())
        assertEquals(0, history.denialCount())
        assertEquals(NotificationPermission.NOT_REQUESTED, capabilities.notificationPermission)
        assertTrue(AndroidPermissionContract.canStartService(capabilities))
    }

    @Test
    fun deniedPromptCanRetryWhileRationaleIsAvailable() {
        history.recordResult(false, true)

        val capabilities = AndroidPermissionContract.evaluate(
            33,
            true,
            false,
            history.promptCount(),
            history.denialCount(),
            true,
        )

        assertEquals(1, history.promptCount())
        assertEquals(1, history.denialCount())
        assertEquals(NotificationPermission.DENIED_CAN_ASK, capabilities.notificationPermission)
        assertTrue(AndroidPermissionContract.canStartService(capabilities))
    }

    @Test
    fun repeatedDenialWithoutRationaleRequiresSystemSettings() {
        history.recordResult(false, true)
        history.recordResult(false, false)

        val capabilities = AndroidPermissionContract.evaluate(
            33,
            true,
            false,
            history.promptCount(),
            history.denialCount(),
            false,
        )

        assertEquals(NotificationPermission.BLOCKED, capabilities.notificationPermission)
        assertTrue(AndroidPermissionContract.canStartService(capabilities))
    }

    @Test
    fun grantedNotificationPermissionAllowsServiceStart() {
        history.recordResult(true, false)

        val capabilities = AndroidPermissionContract.evaluate(
            33,
            true,
            true,
            history.promptCount(),
            history.denialCount(),
            false,
        )

        assertEquals(NotificationPermission.GRANTED, capabilities.notificationPermission)
        assertTrue(AndroidPermissionContract.canStartService(capabilities))
    }
}
