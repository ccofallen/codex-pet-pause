package io.elevenlabs.codexpetpause.overlay

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AndroidServiceLifecycleConcurrencyTest {
    @Test
    fun staleStartCannotClearCommittedQuit() = proveStaleMutationCannotClearQuit { it.start() }

    @Test
    fun staleShowCannotClearCommittedQuit() = proveStaleMutationCannotClearQuit { it.show() }

    @Test
    fun staleHideCannotClearCommittedQuit() = proveStaleMutationCannotClearQuit(
        prepare = { it.show() },
        mutate = { it.hide() },
    )

    private fun proveStaleMutationCannotClearQuit(
        prepare: (AndroidServiceLifecycle) -> Unit = {},
        mutate: (AndroidServiceLifecycle) -> Unit,
    ) {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val preferences = BlockingSharedPreferences()
        val context = PreferencesContext(base, preferences)
        val setup = AndroidServiceLifecycle(preferences)
        setup.noteUserLaunch()
        prepare(setup)

        val staleLifecycle = AndroidServiceLifecycle(preferences)
        val quittingLifecycle = AndroidServiceLifecycle(preferences)
        val observingLifecycle = AndroidServiceLifecycle(preferences)
        val staleFailure = AtomicReference<Throwable?>()
        preferences.blockWritesFrom("stale-lifecycle")

        val staleThread = thread(name = "stale-lifecycle") {
            runCatching { mutate(staleLifecycle) }.exceptionOrNull()?.let(staleFailure::set)
        }
        assertTrue("stale lifecycle mutation did not reach its commit", preferences.awaitBlockedWrite())

        val quitThread = thread(name = "quit-lifecycle") { quittingLifecycle.quit() }
        quitThread.join(2_000)
        assertFalse("Quit must not wait behind an unrelated stale preference editor", quitThread.isAlive)
        assertTrue(observingLifecycle.snapshot().quitRequested)

        preferences.releaseBlockedWrite()
        staleThread.join(2_000)
        assertFalse("stale lifecycle mutation did not finish", staleThread.isAlive)
        staleFailure.get()?.let { throw it }
        assertTrue("a stale non-Quit writer cleared the committed Quit latch", observingLifecycle.snapshot().quitRequested)
    }

    private class PreferencesContext(
        base: Context,
        private val preferences: SharedPreferences,
    ) : ContextWrapper(base) {
        override fun getApplicationContext(): Context = this

        override fun getSharedPreferences(name: String?, mode: Int): SharedPreferences = preferences
    }

    private class BlockingSharedPreferences : SharedPreferences {
        private val values = mutableMapOf<String, Any?>()
        private val blockedWriteReached = CountDownLatch(1)
        private val releaseBlockedWrite = CountDownLatch(1)
        @Volatile private var blockedThreadName: String? = null

        fun blockWritesFrom(threadName: String) {
            blockedThreadName = threadName
        }

        fun awaitBlockedWrite(): Boolean = blockedWriteReached.await(2, TimeUnit.SECONDS)

        fun releaseBlockedWrite() {
            releaseBlockedWrite.countDown()
        }

        override fun getAll(): Map<String, *> = synchronized(values) { values.toMap() }
        override fun getString(key: String?, defValue: String?): String? = synchronized(values) { values[key] as? String ?: defValue }
        override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
            synchronized(values) { (values[key] as? Set<String>)?.toMutableSet() ?: defValues }
        override fun getInt(key: String?, defValue: Int): Int = synchronized(values) { values[key] as? Int ?: defValue }
        override fun getLong(key: String?, defValue: Long): Long = synchronized(values) { values[key] as? Long ?: defValue }
        override fun getFloat(key: String?, defValue: Float): Float = synchronized(values) { values[key] as? Float ?: defValue }
        override fun getBoolean(key: String?, defValue: Boolean): Boolean = synchronized(values) { values[key] as? Boolean ?: defValue }
        override fun contains(key: String?): Boolean = synchronized(values) { values.containsKey(key) }
        override fun edit(): SharedPreferences.Editor = BlockingEditor()
        override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
        override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

        private inner class BlockingEditor : SharedPreferences.Editor {
            private val updates = mutableMapOf<String, Any?>()
            private var clear = false

            override fun putString(key: String?, value: String?): SharedPreferences.Editor = put(key, value)
            override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = put(key, values?.toSet())
            override fun putInt(key: String?, value: Int): SharedPreferences.Editor = put(key, value)
            override fun putLong(key: String?, value: Long): SharedPreferences.Editor = put(key, value)
            override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = put(key, value)
            override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = put(key, value)
            override fun remove(key: String?): SharedPreferences.Editor = put(key, Removed)
            override fun clear(): SharedPreferences.Editor = apply { clear = true }
            override fun commit(): Boolean {
                applyChanges()
                return true
            }
            override fun apply() = applyChanges()

            private fun put(key: String?, value: Any?): SharedPreferences.Editor = apply {
                requireNotNull(key)
                updates[key] = value
            }

            private fun applyChanges() {
                if (Thread.currentThread().name == blockedThreadName) {
                    blockedWriteReached.countDown()
                    assertTrue("timed out waiting to release stale preference write", releaseBlockedWrite.await(2, TimeUnit.SECONDS))
                }
                synchronized(values) {
                    if (clear) values.clear()
                    updates.forEach { (key, value) ->
                        if (value === Removed) values.remove(key) else values[key] = value
                    }
                }
            }
        }

        private object Removed
    }
}
