package io.elevenlabs.codexpetpause.petdex

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PetdexBackNavigatorTest {
    @Test
    fun webViewHistoryNavigatesBackAndKeepsActivityOpen() {
        var goBackCalls = 0
        var finishCalls = 0
        val navigator = PetdexBackNavigator(
            canGoBack = { true },
            goBack = { goBackCalls += 1 },
            finishActivity = { finishCalls += 1 },
        )

        navigator.handle()

        assertEquals(1, goBackCalls)
        assertEquals(0, finishCalls)
    }

    @Test
    fun emptyWebViewHistoryDelegatesToActivityFinish() {
        var goBackCalls = 0
        var finishCalls = 0
        val navigator = PetdexBackNavigator(
            canGoBack = { false },
            goBack = { goBackCalls += 1 },
            finishActivity = { finishCalls += 1 },
        )

        navigator.handle()

        assertEquals(0, goBackCalls)
        assertEquals(1, finishCalls)
    }
}
