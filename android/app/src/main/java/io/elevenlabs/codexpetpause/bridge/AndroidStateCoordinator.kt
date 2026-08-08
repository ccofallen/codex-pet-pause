package io.elevenlabs.codexpetpause.bridge

import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

/** Single serialized boundary for every state mutation exposed by the Capacitor plugin. */
internal class AndroidStateCoordinator(private val store: AndroidStateStore) {
    @Synchronized
    fun loadSnapshot(): String? = store.readSnapshot()?.also(AndroidStateValidator::validateSnapshot)

    @Synchronized
    fun saveSettings(settingsJson: String): String {
        AndroidStateValidator.validateSettings(settingsJson)
        val next = snapshot()
        val merged = preserveCommittedReminderRuntime(next, settingsJson)
        return persist(next.put("settingsJson", merged))
    }

    @Synchronized
    fun saveReminderSettings(settingsJson: String): String {
        AndroidStateValidator.validateSettings(settingsJson)
        return persist(snapshot().put("settingsJson", settingsJson))
    }

    @Synchronized
    fun clearSettings(): String? {
        val current = store.readSnapshot() ?: return null
        return persist(JSONObject(current).put("settingsJson", JSONObject.NULL))
    }

    @Synchronized
    fun appendHistory(eventJson: String): String {
        AndroidStateValidator.validateActivityEvent(eventJson)
        val next = snapshot()
        next.getJSONArray("historyJson").put(eventJson)
        return persist(next)
    }

    @Synchronized
    fun commitReminderAction(settingsJson: String, eventJson: String): String {
        AndroidStateValidator.validateSettings(settingsJson)
        AndroidStateValidator.validateActivityEvent(eventJson)
        val next = snapshot()
        val event = JSONObject(eventJson)
        val merged = applyReminderActionToLatestSettings(next, settingsJson, event)
        next.put("settingsJson", merged)
        next.getJSONArray("historyJson").put(eventJson)
        return persist(next)
    }

    @Synchronized
    fun replaceHistory(historyJson: List<String>): String {
        historyJson.forEach(AndroidStateValidator::validateActivityEvent)
        return persist(snapshot().put("historyJson", JSONArray(historyJson)))
    }

    @Synchronized
    fun clearHistory(): String? {
        val current = store.readSnapshot() ?: return null
        return persist(JSONObject(current).put("historyJson", JSONArray()))
    }

    @Synchronized
    fun savePet(id: String, metadataJson: String, spritesheetBase64: String): String =
        savePetTransaction(id, metadataJson, spritesheetBase64, activate = false)

    @Synchronized
    fun persistValidatedPet(id: String, metadataJson: String, spritesheetBase64: String): String =
        savePetTransaction(id, metadataJson, spritesheetBase64, activate = true)

    private fun savePetTransaction(
        id: String,
        metadataJson: String,
        spritesheetBase64: String,
        activate: Boolean,
    ): String {
        AndroidStateValidator.requireSafePetId(id)
        AndroidStateValidator.validatePetMetadata(metadataJson, id)
        AndroidStateValidator.decodeSpritesheet(spritesheetBase64)
        val current = snapshot()
        val oldAssetPath = current.getJSONArray("pets").let { pets ->
            (0 until pets.length()).map { pets.getJSONObject(it) }
                .firstOrNull { it.getString("id") == id }?.getString("assetPath")
        }
        val newAssetPath = store.writeNewPetVersion(id, metadataJson, spritesheetBase64)
        try {
            val updated = JSONArray()
            val pets = current.getJSONArray("pets")
            for (index in 0 until pets.length()) {
                val pet = pets.getJSONObject(index)
                if (pet.getString("id") != id) updated.put(pet)
            }
            val replacement = petAsset(id, metadataJson, spritesheetBase64, newAssetPath)
            updated.put(replacement)
            current.put("pets", updated)
            val overlay = current.getJSONObject("overlay")
            if (activate || overlay.optJSONObject("activePet")?.optString("id") == id) {
                overlay.put("activePet", replacement)
            }
            if (activate && !current.isNull("settingsJson")) {
                val settings = JSONObject(current.getString("settingsJson")).put("activePetId", id)
                current.put("settingsJson", settings.toString())
            }
            val value = persist(current)
            if (oldAssetPath != null && oldAssetPath != newAssetPath) runCatching { store.deleteAsset(oldAssetPath) }
            return value
        } catch (error: Throwable) {
            runCatching { store.deleteAsset(newAssetPath) }
            throw IOException("save transaction failed; immutable version is unreferenced", error)
        }
    }

    @Synchronized
    fun deletePet(id: String): String? {
        AndroidStateValidator.requireSafePetId(id)
        val current = store.readSnapshot() ?: return null
        val next = JSONObject(current)
        val updated = JSONArray()
        val removedPaths = mutableListOf<String>()
        val pets = next.getJSONArray("pets")
        for (index in 0 until pets.length()) {
            val pet = pets.getJSONObject(index)
            if (pet.getString("id") == id) removedPaths += pet.getString("assetPath") else updated.put(pet)
        }
        next.put("pets", updated)
        val overlay = next.getJSONObject("overlay")
        if (overlay.optJSONObject("activePet")?.optString("id") == id) overlay.remove("activePet")
        val value = persist(next)
        removedPaths.forEach { runCatching { store.deleteAsset(it) } }
        return value
    }

    @Synchronized
    fun clearPets(): String? {
        val current = store.readSnapshot()
        val value = if (current == null) null else {
            val next = JSONObject(current).put("pets", JSONArray())
            next.getJSONObject("overlay").remove("activePet")
            persist(next)
        }
        store.deleteAllPetDirectories()
        return value
    }

    @Synchronized
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
        if (!next.isNull("settingsJson")) {
            val settings = JSONObject(next.getString("settingsJson")).put("activePetId", id)
            next.put("settingsJson", settings.toString())
        }
        return persist(next)
    }

    @Synchronized
    fun saveOverlayPlacement(xRatio: Double, yRatio: Double): String {
        require(xRatio.isFinite() && xRatio in 0.0..1.0) { "Invalid overlay x ratio" }
        require(yRatio.isFinite() && yRatio in 0.0..1.0) { "Invalid overlay y ratio" }
        val next = snapshot()
        next.getJSONObject("overlay").put("xRatio", xRatio).put("yRatio", yRatio)
        if (!next.isNull("settingsJson")) {
            val settings = JSONObject(next.getString("settingsJson"))
            settings.getJSONObject("petPosition").put("xRatio", xRatio).put("yRatio", yRatio)
            next.put("settingsJson", settings.toString())
        }
        return persist(next)
    }

    private fun snapshot(): JSONObject = store.readSnapshot()?.let(::JSONObject) ?: defaultSnapshot()
    private fun persist(snapshot: JSONObject): String = snapshot.toString().also(store::writeSnapshot)

    private fun preserveCommittedReminderRuntime(snapshot: JSONObject, incomingJson: String): String {
        if (snapshot.isNull("settingsJson")) return incomingJson
        val incoming = JSONObject(incomingJson)
        val current = JSONObject(snapshot.getString("settingsJson"))
        val incomingReminders = incoming.getJSONArray("reminders")
        val currentReminders = current.getJSONArray("reminders")
        for (index in 0 until incomingReminders.length()) {
            val candidate = incomingReminders.getJSONObject(index)
            val committed = reminderById(currentReminders, candidate.getString("id")) ?: continue
            if (!sameReminderTiming(candidate, committed)) continue
            candidate
                .put("status", committed.getString("status"))
                .put("nextDueAt", committed.getLong("nextDueAt"))
            if (committed.has("snoozedUntil")) {
                candidate.put("snoozedUntil", committed.getLong("snoozedUntil"))
            } else {
                candidate.remove("snoozedUntil")
            }
        }
        return incoming.toString()
    }

    private fun applyReminderActionToLatestSettings(
        snapshot: JSONObject,
        actionSettingsJson: String,
        event: JSONObject,
    ): String {
        if (snapshot.isNull("settingsJson")) return actionSettingsJson
        val latest = JSONObject(snapshot.getString("settingsJson"))
        val reminders = latest.getJSONArray("reminders")
        val reminder = reminderById(reminders, event.getString("reminderId")) ?: return latest.toString()
        if (!reminder.getBoolean("enabled")) {
            reminder.put("status", "disabled").remove("snoozedUntil")
            return latest.toString()
        }
        when (event.getString("action")) {
            "completed", "skipped" -> reminder
                .put("status", "scheduled")
                .put(
                    "nextDueAt",
                    event.getLong("occurredAt") + reminder.getInt("intervalMinutes") * 60_000L,
                )
                .remove("snoozedUntil")
            "snoozed" -> reminder
                .put("status", "snoozed")
                .put("snoozedUntil", event.getLong("snoozedUntil"))
        }
        return latest.toString()
    }

    /** Labels and preset copy are presentation; they must not replace native runtime. */
    private fun sameReminderTiming(first: JSONObject, second: JSONObject): Boolean =
        first.optString("id") == second.optString("id") &&
            first.optBoolean("enabled") == second.optBoolean("enabled") &&
            first.optInt("intervalMinutes") == second.optInt("intervalMinutes")

    private fun reminderById(reminders: JSONArray, id: String): JSONObject? =
        (0 until reminders.length())
            .map(reminders::getJSONObject)
            .firstOrNull { it.getString("id") == id }

    private fun defaultSnapshot() = JSONObject()
        .put("schemaVersion", 1)
        .put("settingsJson", JSONObject.NULL)
        .put("historyJson", JSONArray())
        .put("pets", JSONArray())
        .put("overlay", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))
    private fun petAsset(id: String, metadataJson: String, spritesheetBase64: String, assetPath: String) = JSONObject()
        .put("id", id)
        .put("metadataJson", metadataJson)
        .put("assetPath", assetPath)
        .put("spritesheetBase64", spritesheetBase64)
}
