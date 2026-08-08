package io.elevenlabs.codexpetpause.bridge

internal data class AndroidCommittedMutationResult(
    val snapshot: String?,
    val eventWarning: Throwable?,
    val refreshWarning: Throwable?,
)

internal object AndroidCommittedMutationEffects {
    fun run(
        mutation: () -> String?,
        emitSnapshot: (String) -> Unit,
        refreshOverlay: (() -> Unit)?,
    ): AndroidCommittedMutationResult {
        val snapshot = mutation()
        if (snapshot == null) return AndroidCommittedMutationResult(null, null, null)
        val eventWarning = runCatching { emitSnapshot(snapshot) }.exceptionOrNull()
        val refreshWarning = refreshOverlay?.let { runCatching(it).exceptionOrNull() }
        return AndroidCommittedMutationResult(snapshot, eventWarning, refreshWarning)
    }
}
