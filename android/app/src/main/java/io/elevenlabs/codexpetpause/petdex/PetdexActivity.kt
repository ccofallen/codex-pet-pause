package io.elevenlabs.codexpetpause.petdex

import android.annotation.SuppressLint
import android.content.Intent
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.SafeBrowsingResponse
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.elevenlabs.codexpetpause.MainActivity
import io.elevenlabs.codexpetpause.R
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal object PetdexSecurityPolicy {
    private const val HOST = "petdex.dev"
    private val archiveMimes = setOf(
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    )

    val webSocketBlockScript = """
        (() => {
          'use strict';
          const unavailable = (name) => function () {
            throw new DOMException(name + ' is unavailable in Petdex', 'SecurityError');
          };
          const lock = (target, name, value) => {
            Object.defineProperty(target, name, {
              value,
              writable: false,
              configurable: false,
              enumerable: false
            });
          };
          for (const name of [
            'Worker',
            'SharedWorker',
            'WebSocket',
            'WebSocketStream',
            'WebTransport',
            'RTCPeerConnection',
            'webkitRTCPeerConnection',
            'EventSource'
          ]) {
            lock(globalThis, name, unavailable(name));
          }
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations()
              .then((registrations) => registrations.forEach((registration) => registration.unregister()))
              .catch(() => undefined);
          }
          if ('ServiceWorkerContainer' in globalThis) {
            lock(
              globalThis.ServiceWorkerContainer.prototype,
              'register',
              () => Promise.reject(new DOMException(
                'ServiceWorker registration is unavailable in Petdex',
                'SecurityError'
              ))
            );
          }
        })();
    """.trimIndent()

    fun shouldEnableJavaScript(documentStartScriptSupported: Boolean): Boolean =
        documentStartScriptSupported

    fun isAllowedPage(url: String): Boolean = isAllowedRequest(url)
    fun isAllowedRequest(url: String): Boolean = isAllowedOrigin(url)

    fun isAllowedDownload(url: String, mimeType: String, suggestedName: String): Boolean {
        val mime = mimeType.substringBefore(';').trim().lowercase(Locale.ROOT)
        return isAllowedOrigin(url)
            && mime in archiveMimes
            && suggestedName.length in 1..255
            && !suggestedName.contains('/')
            && !suggestedName.contains('\\')
            && suggestedName.lowercase(Locale.ROOT).endsWith(".zip")
    }

    fun isAllowedOrigin(url: String): Boolean = runCatching {
        val uri = URI(url)
        uri.scheme == "https"
            && uri.host == HOST
            && uri.userInfo == null
            && (uri.port == -1 || uri.port == 443)
    }.getOrDefault(false)
}

internal object PetdexRestorePolicy {
    fun restoreOrLoad(
        savedState: Bundle?,
        restore: (Bundle) -> Boolean,
        loadInitial: () -> Unit,
    ): Boolean {
        val restored = savedState?.let(restore) == true
        if (!restored) loadInitial()
        return restored
    }
}

class PetdexActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var store: PendingPetArchiveStore
    private var serviceWorkerController: ServiceWorkerController? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val downloadInProgress = AtomicBoolean(false)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = getString(R.string.petdex_title)
        store = PendingPetArchiveStore(cacheDir)
        WebView.setWebContentsDebuggingEnabled(false)
        webView = WebView(this)
        setContentView(webView)
        configureServiceWorkerPolicy()
        val documentStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        val webSocketsBlocked = documentStartSupported && runCatching {
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                PetdexSecurityPolicy.webSocketBlockScript,
                setOf(PETDEX_ORIGIN),
            )
        }.isSuccess
        webView.settings.apply {
            javaScriptEnabled = PetdexSecurityPolicy.shouldEnableJavaScript(webSocketsBlocked)
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            domStorageEnabled = true
            databaseEnabled = false
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            blockNetworkImage = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_NO_CACHE
            setGeolocationEnabled(false)
            mediaPlaybackRequiresUserGesture = true
            safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.removeJavascriptInterface("searchBoxJavaBridge_")
        webView.removeJavascriptInterface("accessibility")
        webView.removeJavascriptInterface("accessibilityTraversal")
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = secureWebViewClient()
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            if (!PetdexSecurityPolicy.isAllowedDownload(url, mimeType.orEmpty(), name)) {
                showError(R.string.petdex_download_rejected)
                return@setDownloadListener
            }
            download(url, userAgent.orEmpty(), name)
        }
        PetdexRestorePolicy.restoreOrLoad(
            savedState = savedInstanceState,
            restore = { webView.restoreState(it)?.size?.let { size -> size > 0 } == true },
            loadInitial = { webView.loadUrl(PETDEX_URL) },
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        scope.cancel()
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun secureWebViewClient() = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (PetdexSecurityPolicy.isAllowedPage(request.url.toString())) return false
            if (request.isForMainFrame) showError(R.string.petdex_navigation_rejected)
            return true
        }

        @Deprecated("Deprecated in Android")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
            if (PetdexSecurityPolicy.isAllowedPage(url)) return false
            showError(R.string.petdex_navigation_rejected)
            return true
        }

        override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
        ): WebResourceResponse? = interceptRequest(request.url.toString())

        @Deprecated("Deprecated in Android")
        override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
            interceptRequest(url)

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            showError(R.string.petdex_secure_connection_failed)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showError(R.string.petdex_page_failed)
        }

        override fun onSafeBrowsingHit(
            view: WebView,
            request: WebResourceRequest,
            threatType: Int,
            callback: SafeBrowsingResponse,
        ) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) callback.backToSafety(true)
        }
    }

    private fun configureServiceWorkerPolicy() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        serviceWorkerController = ServiceWorkerController.getInstance().also { controller ->
            controller.serviceWorkerWebSettings.apply {
                allowContentAccess = false
                allowFileAccess = false
                blockNetworkLoads = true
                cacheMode = WebSettings.LOAD_NO_CACHE
            }
            controller.setServiceWorkerClient(denyAllServiceWorkerClient())
        }
    }

    private fun denyAllServiceWorkerClient() = object : ServiceWorkerClient() {
        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse =
            blockedResponse()
    }

    private fun interceptRequest(url: String): WebResourceResponse? =
        if (PetdexSecurityPolicy.isAllowedRequest(url)) null else blockedResponse()

    private fun blockedResponse() = WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Forbidden",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )

    private fun download(url: String, userAgent: String, suggestedName: String) {
        if (!downloadInProgress.compareAndSet(false, true)) {
            showError(R.string.petdex_download_failed)
            return
        }
        scope.launch {
            try {
                withContext(Dispatchers.IO) { downloadToPrivateStore(url, userAgent, suggestedName) }
                startActivity(Intent(this@PetdexActivity, MainActivity::class.java).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP,
                ))
            } catch (_: Exception) {
                showError(R.string.petdex_download_failed)
            } finally {
                downloadInProgress.set(false)
            }
        }
    }

    private fun downloadToPrivateStore(
        initialUrl: String,
        userAgent: String,
        suggestedName: String,
    ): PendingPetArchive {
        var currentUrl = initialUrl
        repeat(MAX_REDIRECTS + 1) {
            if (!PetdexSecurityPolicy.isAllowedOrigin(currentUrl)) throw IOException("Untrusted Petdex URL")
            val connection = URL(currentUrl).openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                if (userAgent.isNotBlank()) connection.setRequestProperty("User-Agent", userAgent)
                CookieManager.getInstance().getCookie(currentUrl)?.let {
                    connection.setRequestProperty("Cookie", it)
                }
                val status = connection.responseCode
                if (status in 300..399) {
                    val location = connection.getHeaderField("Location")
                        ?: throw IOException("Petdex redirect has no location")
                    currentUrl = URI(currentUrl).resolve(location).toString()
                    return@repeat
                }
                if (status !in 200..299) throw IOException("Petdex download failed")
                val mime = connection.contentType.orEmpty()
                val serverName = URLUtil.guessFileName(
                    currentUrl,
                    connection.getHeaderField("Content-Disposition"),
                    mime,
                ).takeIf { it.lowercase(Locale.ROOT).endsWith(".zip") } ?: suggestedName
                if (!PetdexSecurityPolicy.isAllowedDownload(currentUrl, mime, serverName)) {
                    throw InvalidPetArchive()
                }
                if (connection.contentLengthLong > PendingPetArchiveStore.DEFAULT_MAX_ARCHIVE_BYTES) {
                    throw ArchiveTooLarge()
                }
                return connection.inputStream.use { store.accept(it, mime, serverName) }
            } finally {
                connection.disconnect()
            }
        }
        throw IOException("Too many Petdex redirects")
    }

    private fun showError(message: Int) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    companion object {
        private const val PETDEX_ORIGIN = "https://petdex.dev"
        private const val PETDEX_URL = "$PETDEX_ORIGIN/"
        private const val MAX_REDIRECTS = 3
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000
    }
}
