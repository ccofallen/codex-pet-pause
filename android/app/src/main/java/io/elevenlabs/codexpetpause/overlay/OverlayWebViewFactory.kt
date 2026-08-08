package io.elevenlabs.codexpetpause.overlay

import android.annotation.SuppressLint
import android.content.Context
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
import org.json.JSONObject

enum class OverlayMenuAction {
    SETTINGS,
    HIDE,
    QUIT,
}

sealed interface OverlayWebMessage {
    data object Ready : OverlayWebMessage
    data class MenuAction(val action: OverlayMenuAction) : OverlayWebMessage
    data class BubbleSizeChanged(val widthDp: Int, val heightDp: Int) : OverlayWebMessage
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
            else -> null
        }
    }.getOrNull()
}

class OverlayWebViewFactory(
    private val context: Context,
    private val onMessage: (OverlayWebMessage) -> Unit,
) {
    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .addPathHandler("/local-files/", WebViewAssetLoader.InternalStoragePathHandler(context, context.filesDir))
        .build()

    @SuppressLint("SetJavaScriptEnabled")
    fun create(): WebView = WebView(context).apply {
        setBackgroundColor(Color.TRANSPARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.mediaPlaybackRequiresUserGesture = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.safeBrowsingEnabled = true
        addJavascriptInterface(OverlayJavascriptBridge(onMessage), BRIDGE_NAME)
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !isAllowedUri(request.url)

            @Deprecated("Deprecated in Android")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                !isAllowedUri(Uri.parse(url))
        }
        loadUrl(OVERLAY_URL)
    }

    internal fun isAllowedUri(uri: Uri): Boolean {
        if (uri.scheme != "https" || uri.host != LOCAL_HOST || uri.port != -1 || uri.userInfo != null) return false
        val path = uri.path ?: return false
        return path.startsWith("/assets/") || path.startsWith("/local-files/")
    }

    companion object {
        private const val LOCAL_HOST = "appassets.androidplatform.net"
        private const val BRIDGE_NAME = "AndroidOverlay"
        const val OVERLAY_URL = "https://appassets.androidplatform.net/assets/index.html?overlay=1"
    }
}
