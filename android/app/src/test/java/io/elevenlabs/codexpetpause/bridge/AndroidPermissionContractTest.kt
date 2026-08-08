package io.elevenlabs.codexpetpause.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidPermissionContractTest {
    @Test
    fun notificationPermissionExistsOnlyOnAndroid13AndNewer() {
        assertEquals(
            NotificationPermission.NOT_REQUIRED,
            AndroidPermissionContract.evaluate(
                apiLevel = 32,
                overlayGranted = false,
                notificationsGranted = false,
                notificationPromptCount = 0,
                notificationDenialCount = 0,
                shouldShowRationale = false,
            )
                .notificationPermission,
        )
        assertEquals(
            NotificationPermission.NOT_REQUESTED,
            AndroidPermissionContract.evaluate(
                apiLevel = 33,
                overlayGranted = false,
                notificationsGranted = false,
                notificationPromptCount = 0,
                notificationDenialCount = 0,
                shouldShowRationale = false,
            )
                .notificationPermission,
        )
    }

    @Test
    fun requiresRepeatedNonRequestableDenialBeforeBlocking() {
        assertEquals(
            NotificationPermission.DENIED_CAN_ASK,
            AndroidPermissionContract.evaluate(35, true, false, 1, 0, false).notificationPermission,
        )
        assertEquals(
            NotificationPermission.DENIED_CAN_ASK,
            AndroidPermissionContract.evaluate(35, true, false, 2, 1, true).notificationPermission,
        )
        assertEquals(
            NotificationPermission.BLOCKED,
            AndroidPermissionContract.evaluate(35, true, false, 2, 2, false).notificationPermission,
        )
        assertEquals(
            NotificationPermission.GRANTED,
            AndroidPermissionContract.evaluate(35, true, true, 2, 2, false).notificationPermission,
        )
    }

    @Test
    fun overlayGrantIsTheOnlyPermissionRequiredToStartTheForegroundService() {
        val notificationDenied = AndroidPermissionContract.evaluate(
            apiLevel = 35,
            overlayGranted = true,
            notificationsGranted = false,
            notificationPromptCount = 2,
            notificationDenialCount = 2,
            shouldShowRationale = false,
        )
        val overlayDenied = AndroidPermissionContract.evaluate(
            apiLevel = 35,
            overlayGranted = false,
            notificationsGranted = true,
            notificationPromptCount = 2,
            notificationDenialCount = 2,
            shouldShowRationale = false,
        )

        assertTrue(AndroidPermissionContract.canStartService(notificationDenied))
        assertFalse(AndroidPermissionContract.canStartService(overlayDenied))
    }
}
