package io.elevenlabs.codexpetpause.bridge

import android.content.SharedPreferences

internal class AndroidNotificationPermissionHistory(
    private val preferences: SharedPreferences,
) {
    fun promptCount(): Int = preferences.getInt(KEY_PROMPT_COUNT, 0)

    fun denialCount(): Int = preferences.getInt(KEY_DENIAL_COUNT, 0)

    fun recordResult(
        granted: Boolean,
        shouldShowRationale: Boolean,
    ) {
        if (granted) {
            reset()
        } else {
            val currentDenialCount = denialCount()
            val updatedDenialCount = when {
                shouldShowRationale -> currentDenialCount.coerceAtLeast(1)
                currentDenialCount >= 1 -> BLOCKED_DENIAL_COUNT
                else -> 0
            }
            preferences.edit()
                .putInt(KEY_PROMPT_COUNT, promptCount() + 1)
                .putInt(KEY_DENIAL_COUNT, updatedDenialCount)
                .commit()
        }
    }

    fun reset() {
        preferences.edit()
            .putInt(KEY_PROMPT_COUNT, 0)
            .putInt(KEY_DENIAL_COUNT, 0)
            .commit()
    }

    private companion object {
        const val KEY_PROMPT_COUNT = "notificationPromptCount"
        const val KEY_DENIAL_COUNT = "notificationDenialCount"
        const val BLOCKED_DENIAL_COUNT = 2
    }
}
