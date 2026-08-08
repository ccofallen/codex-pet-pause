package io.elevenlabs.codexpetpause.reminders

import android.app.job.JobScheduler
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

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
}
