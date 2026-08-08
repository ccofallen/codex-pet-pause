package io.elevenlabs.codexpetpause.reminders

import android.app.job.JobParameters
import android.content.Context
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReminderRecoveryRaceTest {
    @Test
    fun quitCommittedAfterJobBeginsPreventsRecoveryPublish() {
        val service = Robolectric.buildService(ReminderRecoveryJobService::class.java).create().get()
        val lifecycle = lifecycle(service)
        lifecycle.noteUserLaunch()

        val recoveryReachedBarrier = CountDownLatch(1)
        val continueRecovery = CountDownLatch(1)
        val recoveryFinished = CountDownLatch(1)
        val published = AtomicBoolean(false)
        service.beforeFinalRecoveryGuard = {
            recoveryReachedBarrier.countDown()
            assertTrue(continueRecovery.await(2, TimeUnit.SECONDS))
        }
        service.reconcileAction = { published.set(true) }
        service.recoveryFinished = { recoveryFinished.countDown() }

        assertTrue(service.onStartJob(newJobParameters()))
        assertTrue(recoveryReachedBarrier.await(2, TimeUnit.SECONDS))
        lifecycle(service).quit()
        continueRecovery.countDown()

        assertTrue(recoveryFinished.await(2, TimeUnit.SECONDS))
        assertFalse("recovery published after Quit committed", published.get())
        assertTrue(lifecycle(service).snapshot().quitRequested)
        service.onDestroy()
    }

    private fun newJobParameters(): JobParameters {
        val constructor = JobParameters::class.java.declaredConstructors.minBy { it.parameterCount }
        constructor.isAccessible = true
        val arguments = constructor.parameterTypes.map { type ->
            when (type) {
                java.lang.Boolean.TYPE -> false
                java.lang.Byte.TYPE -> 0.toByte()
                java.lang.Character.TYPE -> 0.toChar()
                java.lang.Double.TYPE -> 0.0
                java.lang.Float.TYPE -> 0f
                java.lang.Integer.TYPE -> 0
                java.lang.Long.TYPE -> 0L
                java.lang.Short.TYPE -> 0.toShort()
                else -> null
            }
        }.toTypedArray()
        return constructor.newInstance(*arguments) as JobParameters
    }

    private fun lifecycle(context: Context): AndroidServiceLifecycle = AndroidServiceLifecycle(
        context.getSharedPreferences("android-overlay-lifecycle", Context.MODE_PRIVATE),
    )
}
