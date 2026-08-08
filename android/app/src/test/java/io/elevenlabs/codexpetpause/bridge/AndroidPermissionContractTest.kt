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
                notificationRequested = false,
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
                notificationRequested = false,
                shouldShowRationale = false,
            )
                .notificationPermission,
        )
    }

    @Test
    fun distinguishesAskableAndBlockedNotificationDenials() {
        assertEquals(
            NotificationPermission.DENIED_CAN_ASK,
            AndroidPermissionContract.evaluate(35, true, false, true, true).notificationPermission,
        )
        assertEquals(
            NotificationPermission.BLOCKED,
            AndroidPermissionContract.evaluate(35, true, false, true, false).notificationPermission,
        )
        assertEquals(
            NotificationPermission.GRANTED,
            AndroidPermissionContract.evaluate(35, true, true, true, false).notificationPermission,
        )
    }

    @Test
    fun overlayGrantIsTheOnlyPermissionRequiredToStartTheForegroundService() {
        val notificationDenied = AndroidPermissionContract.evaluate(
            apiLevel = 35,
            overlayGranted = true,
            notificationsGranted = false,
            notificationRequested = true,
            shouldShowRationale = false,
        )
        val overlayDenied = AndroidPermissionContract.evaluate(
            apiLevel = 35,
            overlayGranted = false,
            notificationsGranted = true,
            notificationRequested = true,
            shouldShowRationale = false,
        )

        assertTrue(AndroidPermissionContract.canStartService(notificationDenied))
        assertFalse(AndroidPermissionContract.canStartService(overlayDenied))
    }
}
