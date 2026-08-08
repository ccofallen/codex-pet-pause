package io.elevenlabs.codexpetpause.petdex

internal enum class PendingArchiveOutcome {
    IMPORTED,
    CANCELLED,
    REJECTED,
    RETRY;

    companion object {
        fun fromWire(value: String): PendingArchiveOutcome = when (value) {
            "imported" -> IMPORTED
            "cancelled" -> CANCELLED
            "rejected" -> REJECTED
            "retry" -> RETRY
            else -> throw IllegalArgumentException("Invalid pending archive outcome")
        }
    }
}

internal class PendingPetImportQueue(private val store: PendingPetArchiveStore) {
    private var announcedToken: String? = null
    private var claimedToken: String? = null

    @Synchronized
    fun nextAnnouncement(): String? {
        if (announcedToken != null || claimedToken != null) return null
        return store.pendingTokens().firstOrNull()?.also { announcedToken = it }
    }

    @Synchronized
    fun claim(token: String): PendingPetArchiveData {
        require(claimedToken == null) { "Another pending archive is already claimed" }
        val first = store.pendingTokens().firstOrNull() ?: throw PendingArchiveMissing()
        require(token == first && (announcedToken == null || announcedToken == token)) {
            "Pending archives must be claimed in FIFO order"
        }
        val archive = store.peek(token)
        announcedToken = null
        claimedToken = token
        return archive
    }

    @Synchronized
    fun finish(token: String, outcome: PendingArchiveOutcome): String? {
        if (outcome != PendingArchiveOutcome.RETRY && store.isCompleted(token)) {
            return claimedToken ?: announcedToken ?: nextAnnouncement()
        }
        require(token == claimedToken || (outcome == PendingArchiveOutcome.RETRY && token == announcedToken)) {
            "Pending archive is not claimed"
        }
        if (outcome != PendingArchiveOutcome.RETRY) store.acknowledge(token)
        claimedToken = null
        announcedToken = null
        return if (outcome == PendingArchiveOutcome.RETRY) null else nextAnnouncement()
    }
}
