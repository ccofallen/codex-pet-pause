package io.elevenlabs.codexpetpause.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.AssetManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException
import org.json.JSONObject

enum class OverlayMenuAction {
    SETTINGS,
    HIDE,
    QUIT,
}

enum class OverlayReminderAction {
    COMPLETE,
    SNOOZE,
    SKIP,
}

sealed interface OverlayWebMessage {
    data object Ready : OverlayWebMessage
    data class MenuAction(val action: OverlayMenuAction) : OverlayWebMessage
    data class BubbleSizeChanged(val widthDp: Int, val heightDp: Int) : OverlayWebMessage
    data class ReminderAction(
        val reminderId: String,
        val action: OverlayReminderAction,
        val snoozeMinutes: Int? = null,
    ) : OverlayWebMessage
}

internal class OverlayJavascriptBridge(private val onMessage: (OverlayWebMessage) -> Unit) {
    @JavascriptInterface
    fun postMessage(messageJson: String) {
        parseMessage(messageJson)?.let(onMessage)
    }

    private fun parseMessage(messageJson: String): OverlayWebMessage? = runCatching {
        val message = JSONObject(messageJson)
        when (message.optString("type")) {
            "overlay-ready" -> OverlayWebMessage.Ready
            "menu-action" -> OverlayWebMessage.MenuAction(
                when (message.optString("action")) {
                    "settings" -> OverlayMenuAction.SETTINGS
                    "hide" -> OverlayMenuAction.HIDE
                    "quit" -> OverlayMenuAction.QUIT
                    else -> return null
                },
            )
            "bubble-size-changed" -> {
                val width = message.optDouble("widthDp", Double.NaN)
                val height = message.optDouble("heightDp", Double.NaN)
                if (!width.isFinite() || !height.isFinite() || width !in 1.0..600.0 || height !in 1.0..600.0) {
                    return null
                }
                OverlayWebMessage.BubbleSizeChanged(width.toInt(), height.toInt())
            }
            "reminder-action" -> {
                val reminderId = message.optString("reminderId")
                if (reminderId.isBlank() || reminderId.length > 64) return null
                when (message.optString("action")) {
                    "complete" -> OverlayWebMessage.ReminderAction(reminderId, OverlayReminderAction.COMPLETE)
                    "skip" -> OverlayWebMessage.ReminderAction(reminderId, OverlayReminderAction.SKIP)
                    "snooze" -> {
                        val minutes = message.optInt("snoozeMinutes", -1)
                        if (minutes !in setOf(5, 10, 15)) return null
                        OverlayWebMessage.ReminderAction(reminderId, OverlayReminderAction.SNOOZE, minutes)
                    }
                    else -> return null
                }
            }
            else -> null
        }
    }.getOrNull()
}

private class PublicAssetsPathHandler(
    private val assets: AssetManager,
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        if (!isSafeRelativePath(path)) return null
        return try {
            successResponse(mimeType(path), assets.open("public/$path", AssetManager.ACCESS_STREAMING))
        } catch (_: FileNotFoundException) {
            null
        }
    }
}

private class ImmutablePetPathHandler(
    private val filesDir: File,
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        if (!IMMUTABLE_PET_PATH.matches(path)) return null
        val file = File(filesDir, path)
        if (!file.isFile) return null
        return successResponse("image/webp", file.inputStream())
    }
}

class OverlayWebViewFactory(
    context: Context,
    private val onMessage: (OverlayWebMessage) -> Unit,
) {
    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler(APP_PATH_PREFIX, PublicAssetsPathHandler(context.assets))
        .addPathHandler(PET_PATH_PREFIX, ImmutablePetPathHandler(context.filesDir))
        .build()
    private val appContext = context

    @SuppressLint("SetJavaScriptEnabled")
    fun create(): WebView = WebView(appContext).apply {
        setBackgroundColor(Color.TRANSPARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.blockNetworkLoads = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.mediaPlaybackRequiresUserGesture = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.safeBrowsingEnabled = true
        addJavascriptInterface(OverlayJavascriptBridge(onMessage), BRIDGE_NAME)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
                intercept(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !isAllowedUri(request.url)

            @Deprecated("Deprecated in Android")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                !isAllowedUri(Uri.parse(url))
        }
        loadUrl(OVERLAY_URL)
    }

    internal fun intercept(uri: Uri): WebResourceResponse {
        if (!isAllowedUri(uri)) return errorResponse(403, "Blocked")
        return assetLoader.shouldInterceptRequest(uri) ?: errorResponse(404, "Not found")
    }

    internal fun isAllowedUri(uri: Uri): Boolean {
        if (uri.scheme != "https" || uri.host != LOCAL_HOST || uri.port != -1 || uri.userInfo != null) return false
        val path = uri.path ?: return false
        return when {
            path.startsWith(APP_PATH_PREFIX) -> isSafeRelativePath(path.removePrefix(APP_PATH_PREFIX))
            path.startsWith(PET_PATH_PREFIX) -> IMMUTABLE_PET_PATH.matches(path.removePrefix(PET_PATH_PREFIX))
            else -> false
        }
    }

    companion object {
        private const val LOCAL_HOST = "appassets.androidplatform.net"
        private const val BRIDGE_NAME = "AndroidOverlay"
        private const val APP_PATH_PREFIX = "/app/"
        private const val PET_PATH_PREFIX = "/pet-assets/"
        const val OVERLAY_URL = "https://appassets.androidplatform.net/app/index.html?overlay=1"
    }
}

private val IMMUTABLE_PET_PATH =
    Regex("^pets/[A-Za-z0-9][A-Za-z0-9_-]{0,63}/[a-f0-9]{32}/spritesheet\\.webp$")

private fun isSafeRelativePath(path: String): Boolean = path.isNotBlank()
    && !path.startsWith('/')
    && path.split('/').none { it.isBlank() || it == "." || it == ".." }

private fun mimeType(path: String): String = when (path.substringAfterLast('.', "")) {
    "css" -> "text/css"
    "html" -> "text/html"
    "js", "mjs" -> "text/javascript"
    "json", "webmanifest" -> "application/json"
    "png" -> "image/png"
    "svg" -> "image/svg+xml"
    "wav" -> "audio/wav"
    "webp" -> "image/webp"
    "woff2" -> "font/woff2"
    else -> "application/octet-stream"
}

private fun successResponse(mimeType: String, data: java.io.InputStream) = WebResourceResponse(
    mimeType,
    if (mimeType.startsWith("text/") || mimeType == "application/json") "UTF-8" else null,
    200,
    "OK",
    mapOf(
        "Content-Security-Policy" to "default-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
        "X-Content-Type-Options" to "nosniff",
    ),
    data,
)

private fun errorResponse(statusCode: Int, reason: String) = WebResourceResponse(
    "text/plain",
    "UTF-8",
    statusCode,
    reason,
    mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"),
    ByteArrayInputStream(ByteArray(0)),
)
