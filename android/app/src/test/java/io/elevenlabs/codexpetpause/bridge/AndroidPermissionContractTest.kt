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
            AndroidPermissionContract.evaluate(apiLevel = 32, overlayGranted = false, notificationsGranted = false)
                .notificationPermission,
        )
        assertEquals(
            NotificationPermission.DENIED,
            AndroidPermissionContract.evaluate(apiLevel = 33, overlayGranted = false, notificationsGranted = false)
                .notificationPermission,
        )
    }

    @Test
    fun overlayGrantIsTheOnlyPermissionRequiredToStartTheForegroundService() {
        val notificationDenied = AndroidPermissionContract.evaluate(
            apiLevel = 35,
            overlayGranted = true,
            notificationsGranted = false,
        )
        val overlayDenied = AndroidPermissionContract.evaluate(
            apiLevel = 35,
            overlayGranted = false,
            notificationsGranted = true,
        )

        assertTrue(AndroidPermissionContract.canStartService(notificationDenied))
        assertFalse(AndroidPermissionContract.canStartService(overlayDenied))
    }
}
