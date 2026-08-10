package io.elevenlabs.codexpetpause.petdex

import android.webkit.ServiceWorkerClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

internal object PetdexProcessServiceWorkerPolicy {
    val client = object : ServiceWorkerClient() {
        override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
            if (PetdexSecurityPolicy.isAllowedSubresource(request.url.toString())) null else blockedResponse()
    }

    private fun blockedResponse() = WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Forbidden",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )
}
