package io.elevenlabs.codexpetpause.petdex

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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
    fun `installs a deny by default process guard before Petdex JavaScript`() {
        val guardInstall = activitySource.indexOf("configureServiceWorkerPolicy()")
        val javascriptEnable = activitySource.indexOf("javaScriptEnabled =")

        assertTrue(guardInstall >= 0 && guardInstall < javascriptEnable)
        assertTrue(activitySource.contains("blockNetworkLoads = true"))
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
    fun `existing Petdex registrations are neutralized without being the network boundary`() {
        assertTrue(activitySource.contains("getRegistrations"))
        assertTrue(activitySource.contains("unregister"))
        assertTrue(processPolicySource.contains("ServiceWorkerClient"))
        assertTrue(activitySource.contains("blockedResponse()"))
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
}
