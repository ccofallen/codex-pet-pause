package io.elevenlabs.codexpetpause.bridge

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.PluginMethod
import org.json.JSONObject

@CapacitorPlugin(name = "AndroidHost")
class AndroidHostPlugin : Plugin() {
    private lateinit var store: AndroidStateStore

    override fun load() {
        store = AndroidStateStore(context.filesDir)
    }

    @PluginMethod
    fun loadSnapshot(call: PluginCall) = call.resolve(snapshot())

    @PluginMethod
    fun saveSettings(call: PluginCall) {
        val settings = call.getString("json") ?: return call.reject("settings JSON is required")
        try {
            val next = snapshot()
            next.put("settingsJson", JSONObject(settings).toString())
            persist(next)
            call.resolve()
        } catch (error: Exception) {
            call.reject("invalid settings JSON", error)
        }
    }

    @PluginMethod
    fun appendHistory(call: PluginCall) {
        val event = call.getString("json") ?: return call.reject("history JSON is required")
        try {
            val next = snapshot()
            val history = next.getJSONArray("historyJson")
            history.put(JSONObject(event).toString())
            persist(next)
            call.resolve()
        } catch (error: Exception) {
            call.reject("invalid history JSON", error)
        }
    }

    @PluginMethod
    fun savePet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        val metadata = call.getString("metadataJson") ?: return call.reject("pet metadata is required")
        val spritesheet = call.getString("spritesheetBase64") ?: return call.reject("pet spritesheet is required")
        try {
            JSONObject(metadata)
            store.writePet(id, metadata, spritesheet)
            val next = snapshot()
            val pets = next.getJSONArray("pets")
            val updated = JSArray()
            for (index in 0 until pets.length()) {
                val pet = pets.getJSONObject(index)
                if (pet.getString("id") != id) updated.put(pet)
            }
            updated.put(JSObject().put("id", id).put("metadataJson", metadata)
                .put("assetPath", "pets/$id/spritesheet.webp").put("spritesheetBase64", spritesheet))
            next.put("pets", updated)
            persist(next)
            call.resolve()
        } catch (error: Exception) {
            call.reject("could not save pet", error)
        }
    }

    @PluginMethod
    fun deletePet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        try {
            store.deletePet(id)
            val next = snapshot()
            val updated = JSArray()
            val pets = next.getJSONArray("pets")
            for (index in 0 until pets.length()) {
                val pet = pets.getJSONObject(index)
                if (pet.getString("id") != id) updated.put(pet)
            }
            next.put("pets", updated)
            next.getJSONObject("overlay").remove("activePet")
            persist(next)
            call.resolve()
        } catch (error: Exception) {
            call.reject("could not delete pet", error)
        }
    }

    @PluginMethod
    fun selectPet(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("pet id is required")
        try {
            val next = snapshot()
            val pets = next.getJSONArray("pets")
            var selected: JSONObject? = null
            for (index in 0 until pets.length()) {
                val pet = pets.getJSONObject(index)
                if (pet.getString("id") == id) selected = pet
            }
            if (selected == null) return call.reject("pet not found")
            next.getJSONObject("overlay").put("activePet", selected)
            persist(next)
            call.resolve()
        } catch (error: Exception) {
            call.reject("could not select pet", error)
        }
    }

    private fun snapshot(): JSObject {
        val current = store.readSnapshot()
        return if (current == null) defaultSnapshot() else JSObject(current)
    }

    private fun defaultSnapshot(): JSObject = JSObject().apply {
        put("schemaVersion", 1)
        put("settingsJson", "{}")
        put("historyJson", JSArray())
        put("pets", JSArray())
        put("overlay", JSObject().put("xRatio", 0.82).put("yRatio", 0.72))
    }

    private fun persist(value: JSObject) {
        store.writeSnapshot(value.toString())
        notifyListeners("stateChanged", JSObject().put("snapshot", value))
    }
}
