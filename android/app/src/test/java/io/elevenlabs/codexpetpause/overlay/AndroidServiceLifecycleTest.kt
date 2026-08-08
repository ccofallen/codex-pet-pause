package io.elevenlabs.codexpetpause.overlay

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidServiceLifecycleTest {
    private fun lifecycle(): AndroidServiceLifecycle {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val preferences = context.getSharedPreferences("task-7-${System.nanoTime()}", Context.MODE_PRIVATE)
        return AndroidServiceLifecycle(preferences)
    }

    @Test
    fun hideSurvivesServiceRecreationWithoutStoppingBackgroundOperation() {
        val lifecycle = lifecycle()

        assertTrue(lifecycle.start().petVisible)
        val hidden = lifecycle.hide()
        assertTrue(hidden.serviceActive)
        assertFalse(hidden.petVisible)
        assertTrue(hidden.recoveryAllowed)

        val recreated = AndroidServiceLifecycle(lifecycle.preferences)
        assertFalse(recreated.start().petVisible)
    }

    @Test
    fun quitBlocksRecoveryUntilAUserLaunchesAgain() {
        val lifecycle = lifecycle()
        lifecycle.start()

        val quit = lifecycle.quit()
        assertFalse(quit.serviceActive)
        assertFalse(quit.petVisible)
        assertFalse(quit.recoveryAllowed)
        assertFalse(AndroidServiceLifecycle(lifecycle.preferences).snapshot().recoveryAllowed)

        lifecycle.noteUserLaunch()
        val relaunched = lifecycle.start()
        assertTrue(relaunched.serviceActive)
        assertTrue(relaunched.petVisible)
        assertTrue(relaunched.recoveryAllowed)
    }

    @Test
    fun permissionRevocationHidesTheOverlayWithoutDisablingBackgroundOperation() {
        val lifecycle = lifecycle()
        lifecycle.start()

        val revoked = lifecycle.permissionRevoked()

        assertTrue(revoked.serviceActive)
        assertFalse(revoked.petVisible)
        assertTrue(revoked.recoveryAllowed)
    }
}
