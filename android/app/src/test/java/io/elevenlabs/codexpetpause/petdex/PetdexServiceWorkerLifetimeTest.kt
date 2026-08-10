package io.elevenlabs.codexpetpause.petdex

import android.net.Uri
import android.webkit.WebResourceRequest
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PetdexServiceWorkerLifetimeTest {
    private val activitySource by lazy {
        sequenceOf(
            File("src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt"),
            File("app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt"),
        ).first(File::isFile).readText()
    }
    private val processPolicySource by lazy {
        sequenceOf(
            File("src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexProcessServiceWorkerPolicy.kt"),
            File("app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexProcessServiceWorkerPolicy.kt"),
        ).firstOrNull(File::isFile)?.readText().orEmpty()
    }

    @Test
    fun `installs an exact-origin process guard before Petdex JavaScript`() {
        val guardInstall = activitySource.indexOf("configureServiceWorkerPolicy()")
        val javascriptEnable = activitySource.indexOf("javaScriptEnabled =")

        assertTrue(guardInstall >= 0 && guardInstall < javascriptEnable)
        assertTrue(activitySource.contains("blockNetworkLoads = false"))
        assertTrue(activitySource.contains("cacheMode = WebSettings.LOAD_DEFAULT"))
        assertTrue(activitySource.contains(
            "setServiceWorkerClient(PetdexProcessServiceWorkerPolicy.client)",
        ))
    }

    @Test
    fun `activity stop never removes the process lifetime ServiceWorker guard`() {
        assertFalse(activitySource.contains("setServiceWorkerClient(null)"))
        assertFalse(activitySource.contains("clearServiceWorkerPolicy"))
    }

    @Test
    fun `existing Petdex registrations are neutralized while approved official subresources load`() {
        assertTrue(activitySource.contains("getRegistrations"))
        assertTrue(activitySource.contains("unregister"))
        assertTrue(processPolicySource.contains("ServiceWorkerClient"))
        assertTrue(processPolicySource.contains("PetdexSecurityPolicy.isAllowedSubresource"))
    }

    @Test
    fun `process lifetime client allows official assets and blocks untrusted service worker fetches`() {
        assertNull(PetdexProcessServiceWorkerPolicy.client.shouldInterceptRequest(
            serviceWorkerRequest("https://assets.petdex.dev/curated/momo/sprite.png"),
        ))

        val blocked = PetdexProcessServiceWorkerPolicy.client.shouldInterceptRequest(
            serviceWorkerRequest("https://avatars.githubusercontent.com/u/1"),
        )
        assertEquals(403, blocked?.statusCode)
    }

    @Test
    fun `process lifetime client has no Activity WebView or Context reference`() {
        assertTrue(processPolicySource.contains("internal object PetdexProcessServiceWorkerPolicy"))
        assertTrue(processPolicySource.contains("val client"))
        assertFalse(processPolicySource.contains("Activity"))
        assertFalse(processPolicySource.contains("WebView"))
        assertFalse(processPolicySource.contains("Context"))
        assertTrue(activitySource.contains(
            "setServiceWorkerClient(PetdexProcessServiceWorkerPolicy.client)",
        ))
        assertFalse(activitySource.contains("object : ServiceWorkerClient"))
    }

    private fun serviceWorkerRequest(url: String) = object : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(url)
        override fun isForMainFrame(): Boolean = false
        override fun isRedirect(): Boolean = false
        override fun hasGesture(): Boolean = false
        override fun getMethod(): String = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }
}
