package io.elevenlabs.codexpetpause.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.AssetManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import io.elevenlabs.codexpetpause.web.RendererRecoveryGate
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileNotFoundException
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

enum class OverlayMenuAction {
    CLOSE,
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
    data class SurfaceRendered(val mode: String, val generation: Long) : OverlayWebMessage
    data class MenuAction(val action: OverlayMenuAction) : OverlayWebMessage
    data class BubbleSizeChanged(
        val mode: String,
        val generation: Long,
        val widthDp: Int,
        val heightDp: Int,
    ) : OverlayWebMessage
    data class ReminderAction(
        val reminderId: String,
        val action: OverlayReminderAction,
        val snoozeMinutes: Int? = null,
    ) : OverlayWebMessage
}

sealed interface DetachedOverlayWebMessage {
    data class SurfaceReady(
        val mode: DetachedSurfaceMode,
        val generation: Long,
    ) : DetachedOverlayWebMessage
    data class SurfaceSizeChanged(
        val mode: DetachedSurfaceMode,
        val generation: Long,
        val widthDp: Int,
        val heightDp: Int,
    ) : DetachedOverlayWebMessage
    data class SurfaceAction(
        val mode: DetachedSurfaceMode,
        val generation: Long,
        val action: DetachedSurfaceAction,
    ) : DetachedOverlayWebMessage
}

internal class OverlayJavascriptBridge private constructor(
    private val onPetMessage: ((OverlayWebMessage) -> Unit)?,
    private val onDetachedMessage: ((DetachedOverlayWebMessage) -> Unit)?,
) {
    constructor(onMessage: (OverlayWebMessage) -> Unit) : this(onMessage, null)

    @JavascriptInterface
    fun postMessage(messageJson: String) {
        if (onDetachedMessage != null) {
            parseDetachedMessage(messageJson)?.let(onDetachedMessage)
        } else {
            parsePetMessage(messageJson)?.let { onPetMessage?.invoke(it) }
        }
    }

    private fun parsePetMessage(messageJson: String): OverlayWebMessage? = runCatching {
        val message = JSONObject(messageJson)
        when (message.optString("type")) {
            "overlay-ready" -> OverlayWebMessage.Ready
            "surface-rendered" -> {
                val mode = message.optString("mode")
                val generation = message.optLong("generation", -1L)
                if (mode !in setOf("MENU", "BUBBLE") || generation < 0L) return null
                OverlayWebMessage.SurfaceRendered(mode, generation)
            }
            "menu-action" -> OverlayWebMessage.MenuAction(
                when (message.optString("action")) {
                    "close" -> OverlayMenuAction.CLOSE
                    "settings" -> OverlayMenuAction.SETTINGS
                    "hide" -> OverlayMenuAction.HIDE
                    "quit" -> OverlayMenuAction.QUIT
                    else -> return null
                },
            )
            "bubble-size-changed" -> {
                if (message.optString("mode") != "BUBBLE") return null
                val generation = message.optLong("generation", -1L)
                val width = message.optDouble("widthDp", Double.NaN)
                val height = message.optDouble("heightDp", Double.NaN)
                if (!width.isFinite() || !height.isFinite() || width !in 1.0..600.0 || height !in 1.0..600.0) {
                    return null
                }
                if (generation < 0L) return null
                OverlayWebMessage.BubbleSizeChanged("BUBBLE", generation, width.toInt(), height.toInt())
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

    private fun parseDetachedMessage(messageJson: String): DetachedOverlayWebMessage? = runCatching {
        val message = JSONObject(messageJson)
        when (message.optString("type")) {
            "surface-ready" -> parseDetachedReady(message)
            "surface-size-changed" -> parseDetachedMeasurement(message)
            "surface-action" -> parseDetachedAction(message)
            else -> null
        }
    }.getOrNull()

    private fun parseDetachedReady(message: JSONObject): DetachedOverlayWebMessage.SurfaceReady? {
        val mode = message.detachedMode() ?: return null
        val generation = message.exactNonNegativeLong("generation") ?: return null
        return DetachedOverlayWebMessage.SurfaceReady(mode, generation)
    }

    private fun parseDetachedMeasurement(message: JSONObject): DetachedOverlayWebMessage.SurfaceSizeChanged? {
        val mode = message.detachedMode() ?: return null
        val generation = message.exactNonNegativeLong("generation") ?: return null
        val widthDp = message.exactBoundedDimension("widthDp") ?: return null
        val heightDp = message.exactBoundedDimension("heightDp") ?: return null
        return DetachedOverlayWebMessage.SurfaceSizeChanged(mode, generation, widthDp, heightDp)
    }

    private fun parseDetachedAction(message: JSONObject): DetachedOverlayWebMessage.SurfaceAction? {
        val mode = message.detachedMode() ?: return null
        val generation = message.exactNonNegativeLong("generation") ?: return null
        val actionName = message.optString("action")
        val action = when (mode) {
            DetachedSurfaceMode.MENU -> {
                if (message.has("reminderId") || message.has("snoozeMinutes")) return null
                val menuAction = when (actionName) {
                    "close" -> OverlayMenuAction.CLOSE
                    "settings" -> OverlayMenuAction.SETTINGS
                    "hide" -> OverlayMenuAction.HIDE
                    "quit" -> OverlayMenuAction.QUIT
                    else -> return null
                }
                DetachedSurfaceAction.Menu(generation, menuAction)
            }
            DetachedSurfaceMode.BUBBLE -> {
                val reminderId = message.opt("reminderId") as? String ?: return null
                if (reminderId.isBlank() || reminderId.length > 64) return null
                when (actionName) {
                    "complete" -> {
                        if (message.has("snoozeMinutes")) return null
                        DetachedSurfaceAction.Reminder(generation, reminderId, OverlayReminderAction.COMPLETE)
                    }
                    "skip" -> {
                        if (message.has("snoozeMinutes")) return null
                        DetachedSurfaceAction.Reminder(generation, reminderId, OverlayReminderAction.SKIP)
                    }
                    "snooze" -> {
                        val minutes = message.exactBoundedInt("snoozeMinutes", setOf(5, 10, 15)) ?: return null
                        DetachedSurfaceAction.Reminder(
                            generation,
                            reminderId,
                            OverlayReminderAction.SNOOZE,
                            minutes,
                        )
                    }
                    else -> return null
                }
            }
        }
        return DetachedOverlayWebMessage.SurfaceAction(mode, generation, action)
    }

    companion object {
        fun forDetached(onMessage: (DetachedOverlayWebMessage) -> Unit): OverlayJavascriptBridge =
            OverlayJavascriptBridge(null, onMessage)
    }
}

private fun JSONObject.detachedMode(): DetachedSurfaceMode? = when (opt("mode")) {
    "MENU" -> DetachedSurfaceMode.MENU
    "BUBBLE" -> DetachedSurfaceMode.BUBBLE
    else -> null
}

private fun JSONObject.exactNonNegativeLong(name: String): Long? {
    val value = opt(name) as? Number ?: return null
    val number = value.toDouble()
    if (!number.isFinite() || number < 0.0 || number % 1.0 != 0.0 || number > Long.MAX_VALUE.toDouble()) return null
    return number.toLong()
}

private fun JSONObject.exactBoundedDimension(name: String): Int? {
    val value = opt(name) as? Number ?: return null
    val number = value.toDouble()
    if (!number.isFinite() || number % 1.0 != 0.0 || number !in 1.0..600.0) return null
    return number.toInt()
}

private fun JSONObject.exactBoundedInt(name: String, accepted: Set<Int>): Int? {
    val value = opt(name) as? Number ?: return null
    val number = value.toDouble()
    if (!number.isFinite() || number % 1.0 != 0.0) return null
    return number.toInt().takeIf(accepted::contains)
}

private class PublicAssetsPathHandler(
    private val assets: AssetManager,
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        if (!isSafeRelativePath(path)) return null
        return try {
            val stream = assets.open("public/$path", AssetManager.ACCESS_STREAMING)
            if (path == "index.html") {
                val html = stream.bufferedReader().use { it.readText() }
                val overlayHtml = html.replace(
                    VIEWPORT_META,
                    "<meta name=\"viewport\" content=\"width=600, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no\">",
                )
                successResponse("text/html", ByteArrayInputStream(overlayHtml.toByteArray()))
            } else {
                successResponse(mimeType(path), stream)
            }
        } catch (_: FileNotFoundException) {
            null
        }
    }

    private companion object {
        val VIEWPORT_META = Regex(
            "<meta\\s+name=[\\\"']viewport[\\\"']\\s+content=[\\\"'][^\\\"']*[\\\"']\\s*/?>",
            RegexOption.IGNORE_CASE,
        )
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
    private val onRendererGone: (WebView) -> Unit = {},
    private val onMessage: (OverlayWebMessage) -> Unit,
) {
    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler(APP_PATH_PREFIX, PublicAssetsPathHandler(context.assets))
        .addPathHandler(PET_PATH_PREFIX, ImmutablePetPathHandler(context.filesDir))
        .build()
    private val appContext = context
    private val rendererRecoveryGate = RendererRecoveryGate()

    @SuppressLint("SetJavaScriptEnabled")
    fun create(): WebView = createWebView(
        OVERLAY_URL,
        rendererClient,
        OverlayJavascriptBridge(onMessage),
    )

    fun createDetached(
        mode: DetachedSurfaceMode,
        generation: Long,
        onRendererGone: (WebView) -> Unit,
        onMessage: (WebView, DetachedOverlayWebMessage) -> Unit,
    ): WebView {
        val client = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                onRendererGone(view)
                return true
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
                intercept(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !isAllowedUri(request.url)

            @Deprecated("Deprecated in Android")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                !isAllowedUri(Uri.parse(url))
        }
        lateinit var detachedView: WebView
        detachedView = createWebView(
            detachedOverlayUrl(mode, generation, detachedPageInstances.incrementAndGet()),
            client,
            OverlayJavascriptBridge.forDetached { message -> onMessage(detachedView, message) },
        )
        return detachedView
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(
        url: String,
        client: WebViewClient,
        bridge: OverlayJavascriptBridge,
    ): WebView = WebView(appContext).apply {
        setBackgroundColor(Color.TRANSPARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = false
        settings.setSupportZoom(false)
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.blockNetworkLoads = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.mediaPlaybackRequiresUserGesture = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.safeBrowsingEnabled = true
        addJavascriptInterface(bridge, BRIDGE_NAME)
        webViewClient = client
        loadUrl(url)
    }

    internal val rendererClient = object : WebViewClient() {
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (rendererRecoveryGate.tryBegin()) onRendererGone(view)
            return true
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse =
            intercept(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            !isAllowedUri(request.url)

        @Deprecated("Deprecated in Android")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
            !isAllowedUri(Uri.parse(url))
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
        internal const val BRIDGE_NAME = "AndroidOverlay"
        private const val APP_PATH_PREFIX = "/app/"
        private const val PET_PATH_PREFIX = "/pet-assets/"
        const val OVERLAY_URL = "https://appassets.androidplatform.net/app/index.html?overlay=1"
        const val DETACHED_OVERLAY_URL = "https://appassets.androidplatform.net/app/index.html?overlay=surface"
        private val detachedPageInstances = AtomicLong()
    }
}

internal fun detachedOverlayUrl(
    mode: DetachedSurfaceMode,
    generation: Long,
    instance: Long,
): String {
    require(generation >= 0L) { "Detached generation must be non-negative" }
    require(instance > 0L) { "Detached page instance must be positive" }
    return Uri.parse(OverlayWebViewFactory.DETACHED_OVERLAY_URL)
        .buildUpon()
        .appendQueryParameter("mode", mode.name)
        .appendQueryParameter("generation", generation.toString())
        .appendQueryParameter("instance", instance.toString())
        .build()
        .toString()
}

private val IMMUTABLE_PET_PATH =
    Regex("^pets/[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[a-f0-9]{32}/spritesheet\\.webp$")

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
