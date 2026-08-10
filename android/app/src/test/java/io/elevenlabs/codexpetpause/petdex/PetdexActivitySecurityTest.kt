package io.elevenlabs.codexpetpause.petdex

import android.os.Bundle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PetdexActivitySecurityTest {
    @Test
    fun registeredWebViewClientDetachesTheFailedViewBeforeFinishingPetdex() {
        val activity = org.robolectric.Robolectric.buildActivity(TestPetdexActivity::class.java).setup().get()
        val webView = PetdexActivity::class.java.getDeclaredField("webView").let {
            it.isAccessible = true
            it.get(activity) as android.webkit.WebView
        }
        val client = PetdexActivity::class.java.getDeclaredField("secureClient").let {
            it.isAccessible = true
            it.get(activity) as android.webkit.WebViewClient
        }

        assertTrue(client.onRenderProcessGone(webView, rendererGoneDetail()))

        assertEquals(null, webView.parent)
        assertTrue(activity.isFinishing)
    }

    @Test
    fun rendererLossDisposesTheWebViewAndFinishesPetdexOnlyOnce() {
        val actions = mutableListOf<String>()
        val recovery = PetdexRendererRecovery(
            disposeWebView = { actions += "dispose" },
            finishActivity = { actions += "finish" },
        )

        assertTrue(recovery.handle())
        assertTrue(recovery.handle())

        assertEquals(listOf("dispose", "finish"), actions)
    }

    @Test
    fun officialAssetZipIsDownloadableButCannotBecomeAPage() {
        val archive = "https://assets.petdex.dev/curated/boba/v2/boba.zip"

        assertTrue(PetdexSecurityPolicy.isArchiveNavigation(archive))
        assertTrue(PetdexSecurityPolicy.isAllowedDownload(archive, "application/zip", "boba.zip"))
        assertFalse(PetdexSecurityPolicy.isAllowedPage(archive))
        assertFalse(PetdexSecurityPolicy.isArchiveNavigation("http://assets.petdex.dev/boba.zip"))
        assertFalse(PetdexSecurityPolicy.isArchiveNavigation("https://assets.petdex.dev.evil.example/boba.zip"))
        assertFalse(PetdexSecurityPolicy.isArchiveNavigation("https://assets.petdex.dev/curated/boba"))
    }

    @Test
    fun pagePolicyAllowsOnlyTheExactHttpsProductionOrigin() {
        assertTrue(PetdexSecurityPolicy.isAllowedRequest("https://petdex.dev/"))
        assertTrue(PetdexSecurityPolicy.isAllowedRequest("https://petdex.dev/assets/pet.png"))
        listOf(
            "http://petdex.dev/",
            "https://petdex.dev:444/",
            "https://user@petdex.dev/",
            "https://petdex.dev.evil.example/",
            "https://cdn.petdex.dev/",
            "https://localhost/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://169.254.1.1/",
            "https://10.0.0.1/",
            "https://172.16.0.1/",
            "https://192.168.1.1/",
            "file:///android_asset/private",
            "content://private/provider",
            "data:text/html,blocked",
            "blob:https://petdex.dev/opaque",
        ).forEach { url -> assertFalse(url, PetdexSecurityPolicy.isAllowedRequest(url)) }
    }

    @Test
    fun subresourcePolicyAllowsOnlyExactOfficialOrigins() {
        assertTrue(PetdexSecurityPolicy.isAllowedSubresource("https://petdex.dev/app.css"))
        assertTrue(PetdexSecurityPolicy.isAllowedSubresource(
            "https://assets.petdex.dev/curated/momo/sprite.png",
        ))

        listOf(
            "http://assets.petdex.dev/curated/momo/sprite.png",
            "https://user@assets.petdex.dev/curated/momo/sprite.png",
            "https://assets.petdex.dev:444/curated/momo/sprite.png",
            "https://assets.petdex.dev.evil.example/curated/momo/sprite.png",
            "https://cdn.petdex.dev/curated/momo/sprite.png",
            "https://avatars.githubusercontent.com/u/1",
            "file:///android_asset/momo.png",
            "content://private/provider/momo.png",
            "blob:https://assets.petdex.dev/momo",
        ).forEach { url -> assertFalse(url, PetdexSecurityPolicy.isAllowedSubresource(url)) }
    }

    @Test
    fun blobDownloadsAreSeparateFromPageNavigationAndRemainOriginBound() {
        val safeBlob = "blob:https://petdex.dev/44d9518f-2837-455f-a489-b76ee781f8ef"
        assertFalse(PetdexSecurityPolicy.isAllowedPage(safeBlob))
        assertTrue(PetdexSecurityPolicy.isAllowedBlobDownload(safeBlob, "application/zip", "momo.zip"))
        assertTrue(PetdexSecurityPolicy.isAllowedBlobDownload(
            safeBlob,
            "application/octet-stream",
            "momo.zip",
        ))
        assertFalse(PetdexSecurityPolicy.isAllowedBlobDownload(
            "blob:https://petdex.dev.evil.example/archive",
            "application/zip",
            "momo.zip",
        ))
        assertFalse(PetdexSecurityPolicy.isAllowedBlobDownload(safeBlob, "text/html", "momo.zip"))
        assertFalse(PetdexSecurityPolicy.isAllowedBlobDownload(safeBlob, "application/zip", "../momo.zip"))
        assertFalse(PetdexSecurityPolicy.isAllowedBlobDownload(safeBlob, "application/zip", "momo.webp"))
    }

    @Test
    fun safeBlobMainFrameNavigationIsRecognizedAsAnArchiveDownload() {
        assertTrue(PetdexSecurityPolicy.isArchiveNavigation(
            "blob:https://petdex.dev/44d9518f-2837-455f-a489-b76ee781f8ef",
        ))
        assertFalse(PetdexSecurityPolicy.isArchiveNavigation(
            "blob:https://petdex.dev.evil.example/archive",
        ))
        assertFalse(PetdexSecurityPolicy.isArchiveNavigation("https://petdex.dev/pets/momo"))
    }

    @Test
    fun workerSocketAndLocalNetworkCapabilitiesAreFrozenBeforePageJavascript() {
        assertTrue(PetdexSecurityPolicy.shouldEnableJavaScript(documentStartScriptSupported = true))
        assertFalse(PetdexSecurityPolicy.shouldEnableJavaScript(documentStartScriptSupported = false))
        listOf(
            "Worker",
            "SharedWorker",
            "WebSocket",
            "WebSocketStream",
            "WebTransport",
            "RTCPeerConnection",
            "webkitRTCPeerConnection",
            "EventSource",
        ).forEach { capability ->
            assertTrue(capability, PetdexSecurityPolicy.webSocketBlockScript.contains("'$capability'"))
        }
        assertTrue(PetdexSecurityPolicy.webSocketBlockScript.contains("ServiceWorkerContainer"))
        assertTrue(PetdexSecurityPolicy.webSocketBlockScript.contains("register"))
        assertTrue(PetdexSecurityPolicy.webSocketBlockScript.contains("writable: false"))
        assertTrue(PetdexSecurityPolicy.webSocketBlockScript.contains("configurable: false"))
    }

    @Test
    fun nonNullSavedStateRestoresWhenPossibleAndLoadsFallbackWhenEmpty() {
        val saved = Bundle()
        var restoreCalls = 0
        var loads = 0

        assertTrue(PetdexRestorePolicy.restoreOrLoad(
            savedState = saved,
            restore = { restoreCalls += 1; true },
            loadInitial = { loads += 1 },
        ))
        assertEquals(1, restoreCalls)
        assertEquals(0, loads)

        assertFalse(PetdexRestorePolicy.restoreOrLoad(
            savedState = Bundle(),
            restore = { false },
            loadInitial = { loads += 1 },
        ))
        assertEquals(1, loads)
    }
}

private fun rendererGoneDetail() = object : android.webkit.RenderProcessGoneDetail() {
    override fun didCrash(): Boolean = false
    override fun rendererPriorityAtExit(): Int = 0
}

private class TestPetdexActivity : PetdexActivity() {
    override fun configureServiceWorkerPolicy() = Unit
}
