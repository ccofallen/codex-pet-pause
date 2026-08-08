package io.elevenlabs.codexpetpause.bridge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidHostPluginResumeTest {
    @Test
    fun actualHandleOnResumeRefreshesCapabilitiesAndPublishesEvent() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences("android-overlay-lifecycle", Context.MODE_PRIVATE)
        val serviceLifecycle = AndroidServiceLifecycle(preferences)
        serviceLifecycle.noteUserLaunch()
        val expected = AndroidPermissionContract.evaluate(
            apiLevel = 33,
            overlayGranted = true,
            notificationsGranted = false,
            notificationPromptCount = 1,
            notificationDenialCount = 1,
            shouldShowRationale = true,
        )
        val plugin = RecordingAndroidHostPlugin()
        plugin.installResumeBoundaryForTest(
            serviceLifecycle = serviceLifecycle,
            canDrawOverlay = { true },
            hideOverlay = {},
            capabilitiesProvider = { expected },
            capabilitiesEvent = plugin.emitted::add,
        )

        plugin.resume()

        assertEquals(listOf(expected), plugin.emitted)
        assertEquals(false, serviceLifecycle.snapshot().quitRequested)
    }

    private class RecordingAndroidHostPlugin : AndroidHostPlugin() {
        val emitted = mutableListOf<AndroidPermissionCapabilities>()

        fun resume() = handleOnResume()
    }
}
