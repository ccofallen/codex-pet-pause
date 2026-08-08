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
    fun requestPolicyAllowsOnlyTheExactHttpsProductionOrigin() {
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
