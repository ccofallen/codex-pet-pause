package io.elevenlabs.codexpetpause.bridge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidHostLifecycleTest {
    private fun serviceLifecycle(): AndroidServiceLifecycle {
        val context = ApplicationProvider.getApplicationContext<Context>()
        return AndroidServiceLifecycle(
            context.getSharedPreferences("host-lifecycle-${System.nanoTime()}", Context.MODE_PRIVATE),
        )
    }

    @Test
    fun resumeRechecksCapabilitiesWithoutClearingQuitAndOnlyUserLaunchClearsIt() {
        val serviceLifecycle = serviceLifecycle()
        var currentNotificationState = "blocked"
        val emitted = mutableListOf<String>()
        val hostLifecycle = AndroidHostLifecycle(
            serviceLifecycle = serviceLifecycle,
            canDrawOverlay = { true },
            hideOverlay = {},
            capabilitiesChanged = { emitted += currentNotificationState },
        )
        serviceLifecycle.start()
        serviceLifecycle.quit()

        currentNotificationState = "granted"
        hostLifecycle.onResume()

        assertTrue(serviceLifecycle.snapshot().quitRequested)
        assertEquals(listOf("granted"), emitted)

        hostLifecycle.onUserLaunch()
        assertFalse(serviceLifecycle.snapshot().quitRequested)
    }

    @Test
    fun resumePersistsHideWhenOverlayPermissionWasRevoked() {
        val serviceLifecycle = serviceLifecycle()
        var hideCalls = 0
        var capabilityEvents = 0
        val hostLifecycle = AndroidHostLifecycle(
            serviceLifecycle = serviceLifecycle,
            canDrawOverlay = { false },
            hideOverlay = { hideCalls += 1 },
            capabilitiesChanged = { capabilityEvents += 1 },
        )
        serviceLifecycle.start()

        hostLifecycle.onResume()

        assertTrue(serviceLifecycle.snapshot().serviceActive)
        assertFalse(serviceLifecycle.snapshot().petVisible)
        assertEquals(1, hideCalls)
        assertEquals(1, capabilityEvents)
    }
}
