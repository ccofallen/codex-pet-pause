package io.elevenlabs.codexpetpause.bridge

internal enum class NotificationPermission {
    NOT_REQUIRED,
    NOT_REQUESTED,
    DENIED_CAN_ASK,
    BLOCKED,
    GRANTED,
}

internal data class AndroidPermissionCapabilities(
    val apiLevel: Int,
    val overlayGranted: Boolean,
    val notificationPermission: NotificationPermission,
)

internal object AndroidPermissionContract {
    fun evaluate(
        apiLevel: Int,
        overlayGranted: Boolean,
        notificationsGranted: Boolean,
        notificationRequested: Boolean,
        shouldShowRationale: Boolean,
    ) = AndroidPermissionCapabilities(
        apiLevel = apiLevel,
        overlayGranted = overlayGranted,
        notificationPermission = when {
            apiLevel < 33 -> NotificationPermission.NOT_REQUIRED
            notificationsGranted -> NotificationPermission.GRANTED
            !notificationRequested -> NotificationPermission.NOT_REQUESTED
            shouldShowRationale -> NotificationPermission.DENIED_CAN_ASK
            else -> NotificationPermission.BLOCKED
        },
    )

    fun canStartService(capabilities: AndroidPermissionCapabilities): Boolean =
        capabilities.overlayGranted
}
