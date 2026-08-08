package io.elevenlabs.codexpetpause.bridge

import org.json.JSONArray
import org.json.JSONObject

/** Single testable boundary for every state mutation exposed by the Capacitor plugin. */
internal class AndroidStateCoordinator(private val store: AndroidStateStore) {
    fun loadSnapshot(): String? = store.readSnapshot()?.also(AndroidStateValidator::validateSnapshot)

    fun saveSettings(settingsJson: String): String {
        AndroidStateValidator.validateSettings(settingsJson)
        return persist(snapshot().put("settingsJson", settingsJson))
    }

    fun clearSettings(): String? {
        store.clearSnapshot()
        return null
    }

    fun appendHistory(eventJson: String): String {
        AndroidStateValidator.validateActivityEvent(eventJson)
        val next = snapshot()
        next.getJSONArray("historyJson").put(eventJson)
        return persist(next)
    }

    fun replaceHistory(historyJson: List<String>): String {
        historyJson.forEach(AndroidStateValidator::validateActivityEvent)
        return persist(snapshot().put("historyJson", JSONArray(historyJson)))
    }

    fun clearHistory(): String? {
        val current = store.readSnapshot() ?: return null
        return persist(JSONObject(current).put("historyJson", JSONArray()))
    }

    fun savePet(id: String, metadataJson: String, spritesheetBase64: String): String {
        AndroidStateValidator.requireSafePetId(id)
        AndroidStateValidator.validatePetMetadata(metadataJson, id)
        AndroidStateValidator.decodeSpritesheet(spritesheetBase64)
        val next = snapshot()
        val updated = JSONArray()
        val pets = next.getJSONArray("pets")
        for (index in 0 until pets.length()) {
            val pet = pets.getJSONObject(index)
            if (pet.getString("id") != id) updated.put(pet)
        }
        updated.put(petAsset(id, metadataJson, spritesheetBase64))
        next.put("pets", updated)
        val value = next.toString()
        store.savePetAndSnapshot(id, metadataJson, spritesheetBase64, value)
        return value
    }

    fun deletePet(id: String): String? {
        AndroidStateValidator.requireSafePetId(id)
        val current = store.readSnapshot() ?: return null
        val next = JSONObject(current)
        val updated = JSONArray()
        val pets = next.getJSONArray("pets")
        for (index in 0 until pets.length()) {
            val pet = pets.getJSONObject(index)
            if (pet.getString("id") != id) updated.put(pet)
        }
        next.put("pets", updated)
        val overlay = next.getJSONObject("overlay")
        if (overlay.optJSONObject("activePet")?.optString("id") == id) overlay.remove("activePet")
        val value = next.toString()
        store.deletePetAndSnapshot(id, value)
        return value
    }

    fun clearPets(): String? {
        var current = store.readSnapshot() ?: return null
        val ids = JSONObject(current).getJSONArray("pets").let { pets ->
            (0 until pets.length()).map { pets.getJSONObject(it).getString("id") }
        }
        for (id in ids) current = deletePet(id) ?: return null
        val next = JSONObject(current)
        next.put("pets", JSONArray())
        next.getJSONObject("overlay").remove("activePet")
        return persist(next)
    }

    fun selectPet(id: String): String {
        AndroidStateValidator.requireSafePetId(id)
        val next = snapshot()
        val pets = next.getJSONArray("pets")
        var selected: JSONObject? = null
        for (index in 0 until pets.length()) {
            val pet = pets.getJSONObject(index)
            if (pet.getString("id") == id) selected = pet
        }
        requireNotNull(selected) { "Pet not found" }
        next.getJSONObject("overlay").put("activePet", selected)
        return persist(next)
    }

    private fun snapshot(): JSONObject = store.readSnapshot()?.let(::JSONObject) ?: defaultSnapshot()

    private fun persist(snapshot: JSONObject): String = snapshot.toString().also(store::writeSnapshot)

    private fun defaultSnapshot() = JSONObject()
        .put("schemaVersion", 1)
        .put("settingsJson", "{\"schemaVersion\":5}")
        .put("historyJson", JSONArray())
        .put("pets", JSONArray())
        .put("overlay", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))

    private fun petAsset(id: String, metadataJson: String, spritesheetBase64: String) = JSONObject()
        .put("id", id)
        .put("metadataJson", metadataJson)
        .put("assetPath", "pets/$id/spritesheet.webp")
        .put("spritesheetBase64", spritesheetBase64)
}
