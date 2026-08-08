package io.elevenlabs.codexpetpause.bridge

enum class NotificationPermission {
    NOT_REQUIRED,
    NOT_REQUESTED,
    DENIED_CAN_ASK,
    BLOCKED,
    GRANTED,
}

data class AndroidPermissionCapabilities(
    val apiLevel: Int,
    val overlayGranted: Boolean,
    val notificationPermission: NotificationPermission,
)

object AndroidPermissionContract {
    fun evaluate(
        apiLevel: Int,
        overlayGranted: Boolean,
        notificationsGranted: Boolean,
        notificationPromptCount: Int,
        notificationDenialCount: Int,
        shouldShowRationale: Boolean,
    ): AndroidPermissionCapabilities = AndroidPermissionCapabilities(
        apiLevel = apiLevel,
        overlayGranted = overlayGranted,
        notificationPermission = when {
            apiLevel < 33 -> NotificationPermission.NOT_REQUIRED
            notificationsGranted -> NotificationPermission.GRANTED
            notificationPromptCount <= 0 -> NotificationPermission.NOT_REQUESTED
            notificationDenialCount >= 2 && !shouldShowRationale -> NotificationPermission.BLOCKED
            else -> NotificationPermission.DENIED_CAN_ASK
        },
    )

    fun canStartService(capabilities: AndroidPermissionCapabilities): Boolean =
        capabilities.overlayGranted
}
