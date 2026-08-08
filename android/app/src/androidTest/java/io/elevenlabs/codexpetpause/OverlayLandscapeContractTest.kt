package io.elevenlabs.codexpetpause

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import kotlin.math.abs
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
    fun overlayUsesLiteral56_72_96AndReflowsAttachedEdgeToLandscapeSafeBounds() {
        listOf(56, 72, 96).forEach { size ->
            DeviceQa.stopService()
            DeviceQa.seedState(
                petSize = when (size) {
                    56 -> "small"
                    72 -> "medium"
                    else -> "large"
                },
            )
            DeviceQa.startService(PetOverlayService.START)
            val bounds = DeviceQa.awaitOverlay()
            assertEquals(DeviceQa.dp(size), bounds.width())
            assertEquals(DeviceQa.dp(size), bounds.height())
        }

        DeviceQa.stopService()
        DeviceQa.seedState(petSize = "medium")
        DeviceQa.startService(PetOverlayService.START)
        val portraitPet = DeviceQa.awaitOverlay()
        val portraitSafeBounds = DeviceQa.safeScreenBounds()
        DeviceQa.drag(
            Point(portraitPet.centerX(), portraitPet.centerY()),
            Point(portraitSafeBounds.right - 1, portraitPet.centerY()),
        )
        val portraitAttached = DeviceQa.awaitOverlayChange(portraitPet)
        assertTrue(
            abs(portraitAttached.right - portraitSafeBounds.right) <= DeviceQa.dp(3),
        )

        DeviceQa.forceLandscape()

        var landscapeSafeBounds = Rect()
        var landscapePet = Rect()
        DeviceQa.awaitCondition("attached pet should reflow to current landscape safe edge") {
            landscapeSafeBounds = DeviceQa.safeScreenBounds()
            landscapePet = DeviceQa.overlayWindows().singleOrNull() ?: Rect()
            landscapeSafeBounds.width() > landscapeSafeBounds.height() &&
                landscapePet.width() == DeviceQa.dp(72) &&
                abs(landscapePet.right - landscapeSafeBounds.right) <= DeviceQa.dp(3) &&
                landscapePet.top >= landscapeSafeBounds.top &&
                landscapePet.bottom <= landscapeSafeBounds.bottom
        }

        assertTrue(landscapePet.right > portraitSafeBounds.right)
        assertEquals(DeviceQa.dp(72), landscapePet.width())
        assertEquals(DeviceQa.dp(72), landscapePet.height())

        DeviceQa.drag(
            Point(landscapePet.centerX(), landscapePet.centerY()),
            Point(landscapeSafeBounds.right - 1, landscapeSafeBounds.bottom - 1),
        )
        val clamped = DeviceQa.awaitOverlayChange(landscapePet)
        assertTrue(abs(clamped.right - landscapeSafeBounds.right) <= DeviceQa.dp(3))
        assertTrue(clamped.top >= landscapeSafeBounds.top)
        assertTrue(clamped.bottom <= landscapeSafeBounds.bottom)
    }
}
