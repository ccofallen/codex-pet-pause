package io.elevenlabs.codexpetpause.bridge

import android.content.Intent
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.elevenlabs.codexpetpause.overlay.PetOverlayService

@CapacitorPlugin(name = "AndroidHost")
class AndroidHostPlugin : Plugin() {
    private lateinit var coordinator: AndroidStateCoordinator

    override fun load() {
        coordinator = AndroidStateCoordinator(AndroidStateStore(context.filesDir))
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
                    ContextCompat.startForegroundService(
                        context,
                        Intent(context, PetOverlayService::class.java).setAction(PetOverlayService.STATE_CHANGED),
                    )
                }
            }
            call.resolve()
        } catch (error: Exception) {
            call.reject(message, error)
        }
    }
}
