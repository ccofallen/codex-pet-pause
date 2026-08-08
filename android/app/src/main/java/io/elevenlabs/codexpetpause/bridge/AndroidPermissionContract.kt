package io.elevenlabs.codexpetpause.bridge

internal enum class NotificationPermission { NOT_REQUIRED, GRANTED, DENIED }

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
    ) = AndroidPermissionCapabilities(
        apiLevel = apiLevel,
        overlayGranted = overlayGranted,
        notificationPermission = when {
            apiLevel < 33 -> NotificationPermission.NOT_REQUIRED
            notificationsGranted -> NotificationPermission.GRANTED
            else -> NotificationPermission.DENIED
        },
    )

    fun canStartService(capabilities: AndroidPermissionCapabilities): Boolean =
        capabilities.overlayGranted
}
