package io.elevenlabs.codexpetpause.overlay

import android.content.Context
import android.content.SharedPreferences

data class AndroidServiceState(
    val serviceActive: Boolean,
    val petVisible: Boolean,
    val quitRequested: Boolean,
) {
    val recoveryAllowed: Boolean
        get() = !quitRequested
}

class AndroidServiceLifecycle internal constructor(
    internal val preferences: SharedPreferences,
) {
    fun snapshot(): AndroidServiceState = AndroidServiceState(
        serviceActive = preferences.getBoolean(KEY_ACTIVE, false),
        petVisible = preferences.getBoolean(KEY_VISIBLE, false),
        quitRequested = preferences.getBoolean(KEY_QUIT, false),
    )

    fun noteUserLaunch(): AndroidServiceState = synchronized(RECOVERY_TRANSACTION_LOCK) {
        val state = snapshot()
        preferences.edit()
            .putBoolean(KEY_ACTIVE, if (state.quitRequested) false else state.serviceActive)
            .putBoolean(KEY_VISIBLE, if (state.quitRequested) false else state.petVisible)
            .putBoolean(KEY_QUIT, false)
            .commit()
        snapshot()
    }

    @Synchronized
    fun start(): AndroidServiceState {
        val state = snapshot()
        if (state.quitRequested) return state
        return writeOperational(
            serviceActive = true,
            petVisible = if (state.serviceActive) state.petVisible else true,
        )
    }

    @Synchronized
    fun show(): AndroidServiceState {
        val state = snapshot()
        if (state.quitRequested) return state
        return writeOperational(serviceActive = true, petVisible = true)
    }

    @Synchronized
    fun hide(): AndroidServiceState {
        val state = snapshot()
        return writeOperational(serviceActive = state.serviceActive, petVisible = false)
    }

    @Synchronized
    fun permissionRevoked(): AndroidServiceState {
        val state = snapshot()
        return writeOperational(serviceActive = state.serviceActive, petVisible = false)
    }

    fun quit(): AndroidServiceState = synchronized(RECOVERY_TRANSACTION_LOCK) {
        preferences.edit()
            .putBoolean(KEY_ACTIVE, false)
            .putBoolean(KEY_VISIBLE, false)
            .putBoolean(KEY_QUIT, true)
            .commit()
        snapshot()
    }

    fun runRecoveryIfAllowed(action: () -> Unit): Boolean = synchronized(RECOVERY_TRANSACTION_LOCK) {
        if (!snapshot().recoveryAllowed) {
            false
        } else {
            action()
            true
        }
    }

    private fun writeOperational(
        serviceActive: Boolean,
        petVisible: Boolean,
    ): AndroidServiceState {
        preferences.edit()
            .putBoolean(KEY_ACTIVE, serviceActive)
            .putBoolean(KEY_VISIBLE, petVisible)
            .commit()
        return snapshot()
    }

    companion object {
        private const val PREFERENCES = "android-overlay-lifecycle"
        private const val KEY_ACTIVE = "serviceActive"
        private const val KEY_VISIBLE = "petVisible"
        private const val KEY_QUIT = "quitRequested"
        private val RECOVERY_TRANSACTION_LOCK = Any()

        fun forContext(context: Context): AndroidServiceLifecycle = AndroidServiceLifecycle(
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE),
        )
    }
}
