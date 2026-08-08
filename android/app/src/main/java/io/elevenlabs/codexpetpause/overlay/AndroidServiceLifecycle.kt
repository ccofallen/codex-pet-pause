package io.elevenlabs.codexpetpause.overlay

import android.content.Context
import android.content.SharedPreferences

internal data class AndroidServiceState(
    val serviceActive: Boolean,
    val petVisible: Boolean,
    val quitRequested: Boolean,
) {
    val recoveryAllowed: Boolean get() = !quitRequested
}

internal class AndroidServiceLifecycle internal constructor(
    internal val preferences: SharedPreferences,
) {
    fun snapshot() = AndroidServiceState(
        serviceActive = preferences.getBoolean(KEY_ACTIVE, false),
        petVisible = preferences.getBoolean(KEY_VISIBLE, false),
        quitRequested = preferences.getBoolean(KEY_QUIT, false),
    )

    @Synchronized
    fun noteUserLaunch(): AndroidServiceState {
        val current = snapshot()
        return write(
            serviceActive = if (current.quitRequested) false else current.serviceActive,
            petVisible = if (current.quitRequested) false else current.petVisible,
            quitRequested = false,
        )
    }

    @Synchronized
    fun start(): AndroidServiceState {
        val current = snapshot()
        return write(
            serviceActive = true,
            petVisible = if (current.serviceActive) current.petVisible else true,
            quitRequested = false,
        )
    }

    @Synchronized
    fun show(): AndroidServiceState = write(true, true, false)

    @Synchronized
    fun hide(): AndroidServiceState {
        val current = snapshot()
        return write(current.serviceActive, false, current.quitRequested)
    }

    @Synchronized
    fun permissionRevoked(): AndroidServiceState {
        val current = snapshot()
        return write(current.serviceActive, false, current.quitRequested)
    }

    @Synchronized
    fun quit(): AndroidServiceState = write(false, false, true)

    private fun write(
        serviceActive: Boolean,
        petVisible: Boolean,
        quitRequested: Boolean,
    ): AndroidServiceState {
        preferences.edit()
            .putBoolean(KEY_ACTIVE, serviceActive)
            .putBoolean(KEY_VISIBLE, petVisible)
            .putBoolean(KEY_QUIT, quitRequested)
            .commit()
        return snapshot()
    }

    companion object {
        private const val PREFERENCES = "android-overlay-lifecycle"
        private const val KEY_ACTIVE = "serviceActive"
        private const val KEY_VISIBLE = "petVisible"
        private const val KEY_QUIT = "quitRequested"

        fun forContext(context: Context): AndroidServiceLifecycle = AndroidServiceLifecycle(
            context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE),
        )
    }
}
