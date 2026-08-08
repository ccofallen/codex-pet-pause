package io.elevenlabs.codexpetpause.bridge

internal class AndroidOverlayRefreshRetrier(
    private val command: () -> Unit,
    private val schedule: (delayMillis: Long, action: () -> Unit) -> Unit,
    private val onExhausted: (Throwable) -> Unit = {},
) {
    fun refresh(): Throwable? {
        val failure = runCatching(command).exceptionOrNull() ?: return null
        scheduleRetry(0, failure)
        return failure
    }

    private fun scheduleRetry(index: Int, previousFailure: Throwable) {
        if (index >= RETRY_DELAYS_MS.size) {
            onExhausted(previousFailure)
            return
        }
        schedule(RETRY_DELAYS_MS[index]) {
            val failure = runCatching(command).exceptionOrNull()
            if (failure != null) scheduleRetry(index + 1, failure)
        }
    }

    companion object {
        internal val RETRY_DELAYS_MS = longArrayOf(250L, 1_000L)
    }
}
