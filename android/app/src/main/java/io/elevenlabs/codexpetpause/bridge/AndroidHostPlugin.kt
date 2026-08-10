package io.elevenlabs.codexpetpause.bridge

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import io.elevenlabs.codexpetpause.overlay.AndroidCapabilitiesChangedBus
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import io.elevenlabs.codexpetpause.overlay.PetOverlayStateRefreshBus
import io.elevenlabs.codexpetpause.petdex.PendingPetArchiveStore
import io.elevenlabs.codexpetpause.petdex.PendingArchiveOutcome
import io.elevenlabs.codexpetpause.petdex.PendingPetImportQueue
import io.elevenlabs.codexpetpause.petdex.PetdexActivity
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.Base64
import java.util.Locale

private const val NOTIFICATION_PERMISSION_ALIAS = "notifications"
private const val PERMISSION_PREFERENCES = "android-permission-onboarding"
private const val MAX_SAFE_JAVASCRIPT_INTEGER = 9_007_199_254_740_991L

internal data class AndroidHostPluginEvent(
    val name: String,
    val payload: JSObject,
)

internal fun androidRuntimeStateChangedEvent(revision: Long) = AndroidHostPluginEvent(
    name = "stateChanged",
    payload = JSObject()
        .put("type", "runtimeStateChanged")
        .put("revision", revision),
)

internal fun androidHistoryCutoff(value: Any?): Double? = when (value) {
    is Byte, is Short, is Int, is Long -> value.toLong().let { integer ->
        integer.toDouble().takeIf { integer in 0..MAX_SAFE_JAVASCRIPT_INTEGER }
    }
    is Float, is Double -> value.toDouble().takeIf { it.isFinite() && it >= 0.0 }
    else -> null
}

internal fun deliverOverlayRefresh(
    publish: () -> Int,
    fallback: () -> Throwable?,
): Throwable? {
    val listenerCount = runCatching(publish).getOrNull()
    return if (listenerCount != null && listenerCount > 0) null else fallback()
}

@CapacitorPlugin(
    name = "AndroidHost",
    permissions = [Permission(
        alias = NOTIFICATION_PERMISSION_ALIAS,
        strings = [Manifest.permission.POST_NOTIFICATIONS],
    )],
)
open class AndroidHostPlugin : Plugin() {
    private lateinit var coordinator: AndroidStateCoordinator
    private lateinit var lifecycle: AndroidServiceLifecycle
    private lateinit var hostLifecycle: AndroidHostLifecycle
    private lateinit var pendingArchiveQueue: PendingPetImportQueue
    private lateinit var overlayRefreshRetrier: AndroidOverlayRefreshRetrier
    private var unsubscribeCapabilitiesChanged: (() -> Unit)? = null
    private var unsubscribeCommittedState: (() -> Unit)? = null

    override fun load() {
        coordinator = AndroidStateCoordinatorRegistry.forFilesDir(context.filesDir)
        lifecycle = AndroidServiceLifecycle.forContext(context)
        val handler = Handler(Looper.getMainLooper())
        overlayRefreshRetrier = AndroidOverlayRefreshRetrier(
            command = ::sendOverlayRefreshCommand,
            schedule = { delayMillis, action -> handler.postDelayed(action, delayMillis) },
            onExhausted = { error -> Log.w(TAG, "Overlay refresh retries exhausted", error) },
        )
        pendingArchiveQueue = PendingPetImportQueue(PendingPetArchiveStore(context.cacheDir))
        unsubscribeCapabilitiesChanged = AndroidCapabilitiesChangedBus.subscribe {
            handler.post { notifyCapabilities(capabilitiesJson()) }
        }
        unsubscribeCommittedState = AndroidCommittedStateBus.subscribe { revision ->
            handler.post {
                val event = androidRuntimeStateChangedEvent(revision)
                notifyListeners(event.name, event.payload)
            }
        }
        installResumeBoundary(
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
        announceNextPendingArchive()
    }

    override fun handleOnDestroy() {
        unsubscribeCapabilitiesChanged?.invoke()
        unsubscribeCapabilitiesChanged = null
        unsubscribeCommittedState?.invoke()
        unsubscribeCommittedState = null
        super.handleOnDestroy()
    }

    override fun handleOnResume() {
        hostLifecycle.onResume()
        if (::pendingArchiveQueue.isInitialized) announceNextPendingArchive()
    }

    @PluginMethod
    fun openPetdex(call: PluginCall) {
        activity.startActivity(
            Intent(activity, PetdexActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        call.resolve()
    }

    @PluginMethod
    fun pickPetFiles(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf(
                "application/zip",
                "application/x-zip-compressed",
                "application/json",
                "image/webp",
            ))
        }
        startActivityForResult(call, intent, "petFilesPicked")
    }

    @ActivityCallback
    private fun petFilesPicked(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK) {
            call.resolve(JSObject().put("status", "cancelled").put("files", JSArray()))
            return
        }
        val data = result.data
        val uris = buildList {
            data?.clipData?.let { clip ->
                for (index in 0 until clip.itemCount) add(clip.getItemAt(index).uri)
            }
            data?.data?.let(::add)
        }.distinct()
        if (uris.size !in 1..2) return call.reject("select one ZIP or one JSON and one WebP file")
        try {
            val files = JSArray()
            uris.map(::readSelectedFile).forEach { files.put(it) }
            call.resolve(JSObject().put("status", "selected").put("files", files))
        } catch (error: Exception) {
            call.reject("could not read selected pet files", error)
        }
    }

    @PluginMethod
    fun consumePendingArchive(call: PluginCall) {
        val token = call.getString("token") ?: return call.reject("pending archive token is required")
        try {
            val archive = pendingArchiveQueue.claim(token)
            call.resolve(nativeFileJson(
                archive.name,
                "application/zip",
                archive.bytes,
            ))
        } catch (error: Exception) {
            call.reject("could not claim pending pet archive", error)
        }
    }

    @PluginMethod
    fun refreshPendingArchive(call: PluginCall) {
        pendingArchiveQueue.currentAnnouncement()?.let(::announcePendingArchive)
        call.resolve()
    }

    @PluginMethod
    fun completePendingArchive(call: PluginCall) {
        val token = call.getString("token") ?: return call.reject("pending archive token is required")
        val outcome = call.getString("outcome") ?: return call.reject("pending archive outcome is required")
        try {
            val next = pendingArchiveQueue.finish(token, PendingArchiveOutcome.fromWire(outcome))
            call.resolve(JSObject().put("nextToken", next))
            if (next != null) announcePendingArchive(next)
        } catch (error: Exception) {
            call.reject("could not complete pending pet archive", error)
        }
    }

    @PluginMethod
    fun persistValidatedPet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        val metadata = call.getString("metadataJson") ?: return call.reject("pet metadata is required")
        val spritesheet = call.getString("spritesheetBase64") ?: return call.reject("pet spritesheet is required")
        complete(
            call,
            "could not persist validated pet",
            refreshReminderService = true,
            includeSnapshot = true,
        ) {
            coordinator.persistValidatedPet(id, metadata, spritesheet)
        }
    }

    private fun installResumeBoundary(
        serviceLifecycle: AndroidServiceLifecycle,
        canDrawOverlay: () -> Boolean,
        hideOverlay: () -> Unit,
        capabilitiesChanged: () -> Unit,
    ) {
        hostLifecycle = AndroidHostLifecycle(
            serviceLifecycle = serviceLifecycle,
            canDrawOverlay = canDrawOverlay,
            hideOverlay = hideOverlay,
            capabilitiesChanged = capabilitiesChanged,
        )
    }

    internal fun installResumeBoundaryForTest(
        serviceLifecycle: AndroidServiceLifecycle,
        canDrawOverlay: () -> Boolean,
        hideOverlay: () -> Unit,
        capabilitiesProvider: () -> AndroidPermissionCapabilities,
        capabilitiesEvent: (AndroidPermissionCapabilities) -> Unit,
    ) {
        installResumeBoundary(
            serviceLifecycle = serviceLifecycle,
            canDrawOverlay = canDrawOverlay,
            hideOverlay = hideOverlay,
            capabilitiesChanged = { capabilitiesEvent(capabilitiesProvider()) },
        )
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
        requestPermissionForAlias(
            NOTIFICATION_PERMISSION_ALIAS,
            call,
            "notificationPermissionCallback",
        )
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) {
        AndroidNotificationPermissionHistory(permissionPreferences()).recordResult(
            granted = hasNotificationPermission(),
            shouldShowRationale = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS),
        )
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
    fun loadRuntimeSnapshot(call: PluginCall) {
        try {
            call.resolve(coordinator.loadRuntimeSnapshot()?.let(::JSObject))
        } catch (error: Exception) {
            call.reject("could not load Android runtime state", error)
        }
    }

    @PluginMethod
    fun loadPetCatalog(call: PluginCall) {
        try {
            call.resolve(coordinator.loadPetCatalog()?.let(::JSObject))
        } catch (error: Exception) {
            call.reject("could not load Android pet catalog", error)
        }
    }

    @PluginMethod
    fun saveSettings(call: PluginCall) {
        val settings = call.getString("json") ?: return call.reject("settings JSON is required")
        complete(call, "invalid settings JSON", refreshReminderService = true) { coordinator.saveSettings(settings) }
    }

    @PluginMethod
    fun clearSettings(call: PluginCall) =
        complete(
            call,
            "could not clear settings",
            refreshReminderService = true,
            mutation = coordinator::clearSettings,
        )

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
    fun pruneHistory(call: PluginCall) {
        if (!call.data.has("before") || call.data.isNull("before")) {
            return call.reject("history cutoff is required")
        }
        val before = androidHistoryCutoff(call.data.opt("before"))
            ?: return call.reject("invalid history cutoff")
        complete(call, "invalid history cutoff") { coordinator.pruneHistory(before) }
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
        complete(call, "could not delete pet", refreshReminderService = true) { coordinator.deletePet(id) }
    }

    @PluginMethod
    fun clearPets(call: PluginCall) =
        complete(
            call,
            "could not clear pets",
            refreshReminderService = true,
            mutation = coordinator::clearPets,
        )

    @PluginMethod
    fun selectPet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        complete(call, "could not select pet", refreshReminderService = true) { coordinator.selectPet(id) }
    }

    private fun complete(
        call: PluginCall,
        message: String,
        refreshReminderService: Boolean = false,
        includeSnapshot: Boolean = false,
        mutation: () -> String?,
    ) {
        val result = try {
            AndroidCommittedMutationEffects.run(
                mutation = mutation,
                emitSnapshot = { },
                refreshOverlay = if (refreshReminderService) ({
                    deliverOverlayRefresh(
                        publish = PetOverlayStateRefreshBus::publish,
                        fallback = overlayRefreshRetrier::refresh,
                    )?.let { throw it }
                }) else null,
            )
        } catch (error: Exception) {
            return call.reject(message, error)
        }
        result.eventWarning?.let { Log.w(TAG, "Committed state event could not be published", it) }
        result.refreshWarning?.let { Log.w(TAG, "Committed state overlay refresh will retry later", it) }
        val response = JSObject().put("refreshWarning", result.refreshWarning != null)
        result.bridgeSnapshot(includeSnapshot)?.let { response.put("snapshot", JSObject(it)) }
        call.resolve(response)
    }

    private fun sendOverlayRefreshCommand() {
        val state = lifecycle.snapshot()
        if (state.serviceActive && state.recoveryAllowed) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, PetOverlayService::class.java).setAction(PetOverlayService.STATE_CHANGED),
            )
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

    private fun announceNextPendingArchive() {
        pendingArchiveQueue.nextAnnouncement()?.let(::announcePendingArchive)
    }

    private fun announcePendingArchive(token: String) {
        notifyListeners("petArchiveReady", JSObject().put("token", token), true)
    }

    private fun readSelectedFile(uri: Uri): JSObject {
        val name = context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: throw IOException("Selected file has no display name")
        require(name.length in 1..255 && !name.contains('/') && !name.contains('\\') && !name.contains('\u0000')) {
            "Unsafe selected file name"
        }
        val suffix = name.substringAfterLast('.', "").lowercase(Locale.ROOT)
        val providerMime = context.contentResolver.getType(uri)
            ?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
        val (mime, allowedMimes, maximumBytes) = when (suffix) {
            "zip" -> Triple(
                "application/zip",
                setOf("application/zip", "application/x-zip-compressed", "application/octet-stream"),
                32 * 1024 * 1024,
            )
            "json" -> Triple(
                "application/json",
                setOf("application/json", "text/json", "text/plain", "application/octet-stream"),
                64 * 1024,
            )
            "webp" -> Triple(
                "image/webp",
                setOf("image/webp", "application/octet-stream"),
                16 * 1024 * 1024,
            )
            else -> throw IOException("Unsupported selected pet file")
        }
        if (providerMime != null && providerMime !in allowedMimes) throw IOException("Selected file MIME mismatch")
        val input = context.contentResolver.openInputStream(uri)
            ?: throw IOException("Could not open selected pet file")
        val bytes = input.use { readBounded(it, maximumBytes) }
        if (suffix == "zip" && !hasZipHeader(bytes)) throw IOException("Selected ZIP signature mismatch")
        if (suffix == "webp" && !hasWebpHeader(bytes)) throw IOException("Selected WebP signature mismatch")
        return nativeFileJson(name, mime, bytes)
    }

    private fun readBounded(input: InputStream, maximumBytes: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            if (total + count > maximumBytes) throw IOException("Selected pet file is too large")
            output.write(buffer, 0, count)
            total += count
        }
        if (total == 0) throw IOException("Selected pet file is empty")
        return output.toByteArray()
    }

    private fun nativeFileJson(name: String, mime: String, bytes: ByteArray) = JSObject()
        .put("name", name)
        .put("mimeType", mime)
        .put("base64", Base64.getEncoder().encodeToString(bytes))

    private fun hasZipHeader(bytes: ByteArray): Boolean = bytes.size >= 4
        && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()
        && ((bytes[2] == 3.toByte() && bytes[3] == 4.toByte())
            || (bytes[2] == 5.toByte() && bytes[3] == 6.toByte())
            || (bytes[2] == 7.toByte() && bytes[3] == 8.toByte()))

    private fun hasWebpHeader(bytes: ByteArray): Boolean = bytes.size >= 12
        && bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray())
        && bytes.copyOfRange(8, 12).contentEquals("WEBP".toByteArray())

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
        notificationPromptCount = AndroidNotificationPermissionHistory(permissionPreferences()).promptCount(),
        notificationDenialCount = AndroidNotificationPermissionHistory(permissionPreferences()).denialCount(),
        shouldShowRationale = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS),
    )

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun permissionPreferences() =
        context.getSharedPreferences(PERMISSION_PREFERENCES, Context.MODE_PRIVATE)

    companion object {
        private const val TAG = "AndroidHostPlugin"
    }
}
