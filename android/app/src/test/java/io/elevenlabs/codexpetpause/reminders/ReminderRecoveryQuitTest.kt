package io.elevenlabs.codexpetpause.reminders

import android.app.job.JobScheduler
import android.app.job.JobParameters
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Robolectric

@RunWith(RobolectricTestRunner::class)
class ReminderRecoveryQuitTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val lifecycle = AndroidServiceLifecycle.forContext(context)
    private val jobs = context.getSystemService(JobScheduler::class.java)

    @Before
    fun reset() {
        lifecycle.preferences.edit().clear().commit()
        jobs.cancelAll()
    }

    @After
    fun cleanup() {
        lifecycle.preferences.edit().clear().commit()
        jobs.cancelAll()
    }

    @Test
    fun explicitQuitPreventsAStaleRecoveryPathFromSchedulingAnotherJob() {
        lifecycle.quit()

        JobSchedulerReminderRecovery(context).schedule(System.currentTimeMillis() + 60_000L)

        assertTrue(jobs.allPendingJobs.isEmpty())
    }

    @Test
    fun bootReceiverSuppressesRecoveryAfterQuitAndProcessRecreation() {
        lifecycle.quit()
        assertFalse(AndroidServiceLifecycle.forContext(context).snapshot().recoveryAllowed)

        BootReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))

        assertTrue(jobs.allPendingJobs.isEmpty())
        assertEquals(
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            context.packageManager.getComponentEnabledSetting(ComponentName(context, BootReceiver::class.java)),
        )
    }

    @Test
    fun recoveryJobServiceRefusesWorkAfterQuitAndProcessRecreation() {
        lifecycle.quit()
        val controller = Robolectric.buildService(ReminderRecoveryJobService::class.java).create()
        val service = controller.get()
        val constructor = JobParameters::class.java.getDeclaredConstructor().apply { isAccessible = true }

        val started = service.onStartJob(constructor.newInstance())

        assertFalse(started)
        assertTrue(jobs.allPendingJobs.isEmpty())
        assertEquals(
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            context.packageManager.getComponentEnabledSetting(ComponentName(context, BootReceiver::class.java)),
        )
        controller.destroy()
    }
}
