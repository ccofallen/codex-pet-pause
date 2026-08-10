package io.elevenlabs.codexpetpause.pets

import io.elevenlabs.codexpetpause.bridge.AndroidStateValidator
import android.util.JsonReader
import android.util.JsonToken
import java.io.File
import java.io.Reader
import java.io.StringReader
import org.json.JSONArray
import org.json.JSONObject

internal class AndroidPetCatalog(
    private val thumbnails: PetThumbnailCatalogStore,
) {
    constructor(filesDir: File) : this(PetThumbnailStore(filesDir))

    fun load(snapshotJson: String): String = StringReader(snapshotJson).use(::load)

    fun load(source: Reader): String {
        var schemaVersion: Int? = null
        var revision = 0L
        var settingsJson: String? = null
        var overlayActivePetId: String? = null
        var pets: List<CatalogPet>? = null
        JsonReader(source).use { reader ->
            reader.beginObject()
            while (reader.hasNext()) {
                when (reader.nextName()) {
                    "schemaVersion" -> schemaVersion = reader.nextInt()
                    "runtimeRevision" -> revision = reader.nextNonNegativeLong()
                    "settingsJson" -> settingsJson = when (reader.peek()) {
                        JsonToken.NULL -> null.also { reader.nextNull() }
                        JsonToken.STRING -> reader.nextString()
                        else -> throw IllegalArgumentException("Invalid Android pet catalog")
                    }
                    "pets" -> pets = buildList {
                        reader.beginArray()
                        while (reader.hasNext()) add(reader.readCatalogPet())
                        reader.endArray()
                    }
                    "overlay" -> overlayActivePetId = reader.readOverlayActivePetId()
                    else -> reader.skipValue()
                }
            }
            reader.endObject()
            require(reader.peek() == JsonToken.END_DOCUMENT) { "Invalid Android pet catalog" }
        }
        require(schemaVersion == 1) { "Invalid Android pet catalog" }
        val catalogPets = requireNotNull(pets) { "Invalid Android pet catalog" }
        val assetPaths = catalogPets.map(CatalogPet::assetPath).toSet()
        thumbnails.retain(assetPaths)

        val entries = JSONArray()
        val ids = mutableSetOf<String>()
        for (pet in catalogPets) {
            val id = pet.id
            AndroidStateValidator.requireSafePetId(id)
            require(ids.add(id)) { "Duplicate Android pet id" }
            AndroidStateValidator.validatePetMetadata(pet.metadataJson, id)
            val assetPath = pet.assetPath
            val directory = AndroidStateValidator.assetDirectory(File("/validation"), assetPath)
            require(directory.parentFile?.name == id) { "Invalid Android pet asset path" }
            val thumbnail = try {
                thumbnails.thumbnailBase64(assetPath)
            } catch (_: Exception) {
                null
            }
            entries.put(JSONObject()
                .put("id", id)
                .put("metadataJson", pet.metadataJson)
                .put("assetRevision", directory.name)
                .put("thumbnailBase64", thumbnail ?: JSONObject.NULL))
        }

        val activePetId = settingsJson?.let { JSONObject(it).getString("activePetId") }
            ?: overlayActivePetId ?: "builtin-cat"
        AndroidStateValidator.requireSafePetId(activePetId)
        require(activePetId == "builtin-cat" || activePetId in ids) { "Invalid Android active pet" }

        return JSONObject()
            .put("revision", revision)
            .put("activePetId", activePetId)
            .put("pets", entries)
            .toString()
    }

    private data class CatalogPet(val id: String, val metadataJson: String, val assetPath: String)

    private fun JsonReader.readCatalogPet(): CatalogPet {
        var id: String? = null
        var metadataJson: String? = null
        var assetPath: String? = null
        beginObject()
        while (hasNext()) {
            when (nextName()) {
                "id" -> id = nextString()
                "metadataJson" -> metadataJson = nextString()
                "assetPath" -> assetPath = nextString()
                else -> skipValue()
            }
        }
        endObject()
        return CatalogPet(
            requireNotNull(id) { "Invalid Android pet catalog" },
            requireNotNull(metadataJson) { "Invalid Android pet catalog" },
            requireNotNull(assetPath) { "Invalid Android pet catalog" },
        )
    }

    private fun JsonReader.readOverlayActivePetId(): String? {
        var activePetId: String? = null
        beginObject()
        while (hasNext()) {
            if (nextName() != "activePet" || peek() == JsonToken.NULL) {
                skipValue()
                continue
            }
            beginObject()
            while (hasNext()) {
                if (nextName() == "id") activePetId = nextString() else skipValue()
            }
            endObject()
        }
        endObject()
        return activePetId
    }

    private fun JsonReader.nextNonNegativeLong(): Long {
        require(peek() == JsonToken.NUMBER) { "Invalid Android pet catalog" }
        val value = nextString()
        require(value.matches(Regex("0|[1-9][0-9]*"))) { "Invalid Android pet catalog" }
        return requireNotNull(value.toLongOrNull()) { "Invalid Android pet catalog" }
    }
}
