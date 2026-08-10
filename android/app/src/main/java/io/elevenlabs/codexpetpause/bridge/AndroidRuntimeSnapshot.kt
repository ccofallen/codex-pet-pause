package io.elevenlabs.codexpetpause.bridge

import android.util.JsonReader
import android.util.JsonToken
import java.io.Reader
import java.io.StringReader
import org.json.JSONArray
import org.json.JSONObject

internal data class AndroidRuntimeSnapshot(
    val schemaVersion: Int,
    val revision: Long,
    val settingsJson: String?,
    val historyJson: List<String>,
) {
    fun toJson(): String = JSONObject()
        .put("schemaVersion", schemaVersion)
        .put("revision", revision)
        .put("settingsJson", settingsJson ?: JSONObject.NULL)
        .put("historyJson", JSONArray(historyJson))
        .toString()

    companion object {
        fun fromPersistedJson(value: String): AndroidRuntimeSnapshot =
            StringReader(value).use(::fromPersistedReader)

        fun fromPersistedReader(source: Reader): AndroidRuntimeSnapshot {
            var schemaVersion: Int? = null
            var revision = 0L
            var settingsJson: String? = null
            var hasSettings = false
            var historyJson: List<String>? = null
            JsonReader(source).use { reader ->
                reader.beginObject()
                while (reader.hasNext()) {
                    when (reader.nextName()) {
                        "schemaVersion" -> schemaVersion = reader.nextNonNegativeLong("schemaVersion").toInt()
                        "runtimeRevision" -> revision = reader.nextNonNegativeLong("runtimeRevision")
                        "settingsJson" -> {
                            hasSettings = true
                            settingsJson = when (reader.peek()) {
                                JsonToken.NULL -> null.also { reader.nextNull() }
                                JsonToken.STRING -> reader.nextString()
                                else -> throw IllegalArgumentException("Invalid Android settings JSON")
                            }
                        }
                        "historyJson" -> historyJson = buildList {
                            reader.beginArray()
                            while (reader.hasNext()) {
                                require(reader.peek() == JsonToken.STRING) { "Invalid Android history JSON" }
                                add(reader.nextString())
                            }
                            reader.endArray()
                        }
                        else -> reader.skipValue()
                    }
                }
                reader.endObject()
                require(reader.peek() == JsonToken.END_DOCUMENT) { "Invalid Android state snapshot" }
            }
            require(schemaVersion == 1) { "Unsupported Android state schema" }
            require(hasSettings) { "Invalid Android settings JSON" }
            settingsJson?.let(AndroidStateValidator::validateSettings)
            val history = requireNotNull(historyJson) { "Invalid Android history JSON" }
            history.forEach(AndroidStateValidator::validateActivityEvent)
            return AndroidRuntimeSnapshot(1, revision, settingsJson, history)
        }

        private fun JsonReader.nextNonNegativeLong(field: String): Long {
            require(peek() == JsonToken.NUMBER) { "Invalid Android JSON field: $field" }
            val value = nextString()
            require(value.matches(Regex("0|[1-9][0-9]*"))) { "Invalid Android JSON field: $field" }
            return requireNotNull(value.toLongOrNull()) { "Invalid Android JSON field: $field" }
        }
    }
}
