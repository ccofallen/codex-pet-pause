package io.elevenlabs.codexpetpause.bridge

import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle

internal class AndroidHostLifecycle(
    private val serviceLifecycle: AndroidServiceLifecycle,
    private val canDrawOverlay: () -> Boolean,
    private val hideOverlay: () -> Unit,
    private val capabilitiesChanged: () -> Unit,
) {
    fun onUserLaunch() {
        serviceLifecycle.noteUserLaunch()
    }

    fun onResume() {
        val state = serviceLifecycle.snapshot()
        if (!canDrawOverlay() && state.serviceActive && state.recoveryAllowed) {
            serviceLifecycle.permissionRevoked()
            hideOverlay()
        }
        capabilitiesChanged()
    }
}
