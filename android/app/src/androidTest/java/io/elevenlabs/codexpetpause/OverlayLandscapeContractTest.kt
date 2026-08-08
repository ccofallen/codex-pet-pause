package io.elevenlabs.codexpetpause

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Point
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OverlayLandscapeContractTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
        DeviceQa.setOverlayPermission(true)
    }

    @After
    fun tearDown() {
        DeviceQa.restoreRotation()
        DeviceQa.stopService()
    }

    @Test
    fun grantedNotificationPathStartsWithoutRevokingInstrumentationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            assertEquals(
                PackageManager.PERMISSION_GRANTED,
                ContextCompat.checkSelfPermission(
                    DeviceQa.context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ),
            )
        }

        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)

        DeviceQa.awaitOverlay()
        assertTrue(DeviceQa.hasForegroundServiceNotification())
    }

    @Test
    fun overlayUsesAcceptedSizesAndClampsInsideLandscapeScreen() {
        listOf(56, 72, 96).forEach { size ->
            DeviceQa.stopService()
            DeviceQa.seedState(petSize = when (size) {
                56 -> "small"
                72 -> "medium"
                else -> "large"
            })
            DeviceQa.startService(PetOverlayService.START)
            val bounds = DeviceQa.awaitOverlay()
            assertEquals(DeviceQa.dp(size), bounds.width())
            assertEquals(DeviceQa.dp(size), bounds.height())
        }

        DeviceQa.stopService()
        DeviceQa.seedState(petSize = "medium")
        DeviceQa.startService(PetOverlayService.START)
        DeviceQa.awaitOverlay()
        DeviceQa.forceLandscape()

        val screen = DeviceQa.screenBounds()
        val landscape = DeviceQa.awaitOverlay()
        assertTrue(screen.width() > screen.height())
        assertTrue(screen.contains(landscape))

        DeviceQa.drag(
            Point(landscape.centerX(), landscape.centerY()),
            Point(screen.right - 1, screen.bottom - 1),
        )
        val clamped = DeviceQa.awaitOverlayChange(landscape)
        assertTrue(screen.contains(clamped))
        assertEquals(DeviceQa.dp(72), clamped.width())
        assertEquals(DeviceQa.dp(72), clamped.height())
    }
}
