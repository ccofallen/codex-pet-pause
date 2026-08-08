package io.elevenlabs.codexpetpause.bridge

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import io.elevenlabs.codexpetpause.overlay.PetOverlayService

private const val NOTIFICATION_PERMISSION_ALIAS = "notifications"
private const val PERMISSION_PREFERENCES = "android-permission-onboarding"
private const val KEY_NOTIFICATION_REQUESTED = "notificationRequested"

@CapacitorPlugin(
    name = "AndroidHost",
    permissions = [Permission(
        alias = NOTIFICATION_PERMISSION_ALIAS,
        strings = [Manifest.permission.POST_NOTIFICATIONS],
    )],
)
class AndroidHostPlugin : Plugin() {
    private lateinit var coordinator: AndroidStateCoordinator
    private lateinit var lifecycle: AndroidServiceLifecycle
    private lateinit var hostLifecycle: AndroidHostLifecycle

    override fun load() {
        coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        lifecycle = AndroidServiceLifecycle.forContext(context)
        hostLifecycle = AndroidHostLifecycle(
            serviceLifecycle = lifecycle,
            canDrawOverlay = { Settings.canDrawOverlays(context) },
            hideOverlay = {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, PetOverlayService::class.java).setAction(PetOverlayService.HIDE),
                )
            },
            capabilitiesChanged = { notifyCapabilities(capabilitiesJson()) },
        )
        hostLifecycle.onUserLaunch()
    }

    override fun handleOnResume() {
        hostLifecycle.onResume()
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) = call.resolve(capabilitiesJson())

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        when (permissionCapabilities().notificationPermission) {
            NotificationPermission.NOT_REQUIRED,
            NotificationPermission.GRANTED -> return call.resolve(capabilitiesJson())
            NotificationPermission.BLOCKED -> return openNotificationSettings(call)
            NotificationPermission.NOT_REQUESTED,
            NotificationPermission.DENIED_CAN_ASK -> Unit
        }
        permissionPreferences().edit().putBoolean(KEY_NOTIFICATION_REQUESTED, true).apply()
        requestPermissionForAlias(
            NOTIFICATION_PERMISSION_ALIAS,
            call,
            "notificationPermissionCallback",
        )
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) {
        val capabilities = capabilitiesJson()
        notifyCapabilities(capabilities)
        call.resolve(capabilities)
    }

    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        activity.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )
        call.resolve(capabilitiesJson())
    }

    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        activity.startActivity(Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${context.packageName}"),
        ))
        call.resolve(capabilitiesJson())
    }

    @PluginMethod
    fun startService(call: PluginCall) = sendServiceCommand(call, PetOverlayService.START)

    @PluginMethod
    fun showPet(call: PluginCall) = sendServiceCommand(call, PetOverlayService.SHOW)

    @PluginMethod
    fun hidePet(call: PluginCall) = sendServiceCommand(call, PetOverlayService.HIDE)

    @PluginMethod
    fun quit(call: PluginCall) {
        PetOverlayService.requestQuit(context)
        call.resolve(capabilitiesJson())
    }

    @PluginMethod
    fun loadSnapshot(call: PluginCall) {
        try {
            call.resolve(coordinator.loadSnapshot()?.let(::JSObject))
        } catch (error: Exception) {
            call.reject("could not load Android state", error)
        }
    }

    @PluginMethod
    fun saveSettings(call: PluginCall) {
        val settings = call.getString("json") ?: return call.reject("settings JSON is required")
        complete(call, "invalid settings JSON", refreshReminderService = true) { coordinator.saveSettings(settings) }
    }

    @PluginMethod
    fun clearSettings(call: PluginCall) =
        complete(call, "could not clear settings", refreshReminderService = true, coordinator::clearSettings)

    @PluginMethod
    fun appendHistory(call: PluginCall) {
        val event = call.getString("json") ?: return call.reject("history JSON is required")
        complete(call, "invalid history JSON") { coordinator.appendHistory(event) }
    }

    @PluginMethod
    fun replaceHistory(call: PluginCall) {
        val values = call.getArray("historyJson") ?: return call.reject("history JSON is required")
        val history = try {
            (0 until values.length()).map(values::getString)
        } catch (error: Exception) {
            return call.reject("invalid history JSON", error)
        }
        complete(call, "invalid history JSON") { coordinator.replaceHistory(history) }
    }

    @PluginMethod
    fun clearHistory(call: PluginCall) =
        complete(call, "could not clear history", mutation = coordinator::clearHistory)

    @PluginMethod
    fun savePet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        val metadata = call.getString("metadataJson") ?: return call.reject("pet metadata is required")
        val spritesheet = call.getString("spritesheetBase64") ?: return call.reject("pet spritesheet is required")
        complete(call, "could not save pet") { coordinator.savePet(id, metadata, spritesheet) }
    }

    @PluginMethod
    fun deletePet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        complete(call, "could not delete pet") { coordinator.deletePet(id) }
    }

    @PluginMethod
    fun clearPets(call: PluginCall) =
        complete(call, "could not clear pets", mutation = coordinator::clearPets)

    @PluginMethod
    fun selectPet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        complete(call, "could not select pet") { coordinator.selectPet(id) }
    }

    private fun complete(
        call: PluginCall,
        message: String,
        refreshReminderService: Boolean = false,
        mutation: () -> String?,
    ) {
        try {
            val snapshot = mutation()
            if (snapshot != null) {
                notifyListeners("stateChanged", JSObject().put("snapshot", JSObject(snapshot)))
                if (refreshReminderService) {
                    val state = lifecycle.snapshot()
                    if (state.serviceActive && state.recoveryAllowed) {
                        ContextCompat.startForegroundService(
                            context,
                            Intent(context, PetOverlayService::class.java).setAction(PetOverlayService.STATE_CHANGED),
                        )
                    }
                }
            }
            call.resolve()
        } catch (error: Exception) {
            call.reject(message, error)
        }
    }

    private fun sendServiceCommand(call: PluginCall, command: String) {
        if (!lifecycle.snapshot().recoveryAllowed) {
            return call.reject("app was explicitly quit")
        }
        val permission = permissionCapabilities()
        if ((command == PetOverlayService.START || command == PetOverlayService.SHOW)
            && !AndroidPermissionContract.canStartService(permission)) {
            return call.reject("overlay permission is required")
        }
        val state = when (command) {
            PetOverlayService.START -> lifecycle.start()
            PetOverlayService.SHOW -> lifecycle.show()
            PetOverlayService.HIDE -> lifecycle.hide()
            else -> lifecycle.snapshot()
        }
        if (state.serviceActive) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, PetOverlayService::class.java).setAction(command),
            )
        }
        call.resolve(capabilitiesJson())
    }

    private fun notifyCapabilities(capabilities: JSObject) {
        notifyListeners(
            "capabilitiesChanged",
            JSObject().put("capabilities", capabilities),
            true,
        )
    }

    private fun capabilitiesJson(): JSObject {
        val permissions = permissionCapabilities()
        val state = lifecycle.snapshot()
        return JSObject()
            .put("apiLevel", permissions.apiLevel)
            .put("overlayPermission", if (permissions.overlayGranted) "granted" else "denied")
            .put("notificationPermission", when (permissions.notificationPermission) {
                NotificationPermission.NOT_REQUIRED -> "notRequired"
                NotificationPermission.NOT_REQUESTED -> "notRequested"
                NotificationPermission.DENIED_CAN_ASK -> "deniedCanAsk"
                NotificationPermission.BLOCKED -> "blocked"
                NotificationPermission.GRANTED -> "granted"
            })
            .put("serviceActive", state.serviceActive && state.recoveryAllowed)
            .put("petVisible", state.petVisible && permissions.overlayGranted)
    }

    private fun permissionCapabilities() = AndroidPermissionContract.evaluate(
        apiLevel = Build.VERSION.SDK_INT,
        overlayGranted = Settings.canDrawOverlays(context),
        notificationsGranted = hasNotificationPermission(),
        notificationRequested = permissionPreferences().getBoolean(KEY_NOTIFICATION_REQUESTED, false),
        shouldShowRationale = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS),
    )

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun permissionPreferences() =
        context.getSharedPreferences(PERMISSION_PREFERENCES, Context.MODE_PRIVATE)
}
