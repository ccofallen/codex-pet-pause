package io.elevenlabs.codexpetpause.overlay

import android.view.WindowManager
import android.webkit.WebView
import io.elevenlabs.codexpetpause.reminders.ReminderClock
import io.elevenlabs.codexpetpause.reminders.ReminderLiveTimer
import io.elevenlabs.codexpetpause.reminders.ReminderRecoveryScheduler
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

internal data class DebugPetWindowOperation(
    val sequence: Int,
    val operation: String,
    val viewIdentity: Int,
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int,
)

internal class PetOverlayDebugControls(initialNow: Long) : ReminderClock {
    private val nowMillis = AtomicLong(initialNow)
    private val petOperations = CopyOnWriteArrayList<DebugPetWindowOperation>()
    private val detachedEvents = CopyOnWriteArrayList<DetachedSurfaceWindowEvent>()
    private val mutationSequence = AtomicInteger()
    private val lastPetIdentity = AtomicInteger()
    private val heldLiveTimer = HeldReminderLiveTimer()
    private val heldRecoveryScheduler = HeldReminderRecoveryScheduler()

    internal val liveTimer: ReminderLiveTimer = heldLiveTimer
    internal val recoveryScheduler: ReminderRecoveryScheduler = heldRecoveryScheduler

    override fun now(): Long = nowMillis.get()

    fun advanceClockTo(value: Long) {
        while (true) {
            val current = nowMillis.get()
            require(value >= current) { "Debug reminder clock cannot move backwards" }
            if (nowMillis.compareAndSet(current, value)) return
        }
    }

    fun clearPetLayoutMutations() {
        petOperations.clear()
    }

    fun petLayoutMutations(): List<DebugPetWindowOperation> = petOperations.toList()
    fun clearDetachedSurfaceWindowEvents() = detachedEvents.clear()
    fun detachedSurfaceWindowEvents(): List<DetachedSurfaceWindowEvent> = detachedEvents.toList()
    fun heldLiveScheduleCount(): Int = heldLiveTimer.scheduleCount.get()
    fun heldLiveWakeCount(): Int = heldLiveTimer.wakeCount.get()
    fun heldRecoveryScheduleRequests(): List<Long> = heldRecoveryScheduler.scheduleRequests.toList()
    fun heldRecoveryCancelCount(): Int = heldRecoveryScheduler.cancelCount.get()
    fun heldRecoveryEnabledRequests(): List<Boolean> = heldRecoveryScheduler.enabledRequests.toList()

    internal fun recordPetLayoutMutation(
        operation: String,
        view: WebView,
        params: WindowManager.LayoutParams,
    ) {
        val identity = System.identityHashCode(view)
        if (operation == "add-show") {
            val previous = lastPetIdentity.getAndSet(identity)
            if (previous != 0 && previous != identity) {
                petOperations += DebugPetWindowOperation(
                    mutationSequence.incrementAndGet(),
                    "identity-replacement",
                    identity,
                    params.x,
                    params.y,
                    params.width,
                    params.height,
                )
            }
        }
        petOperations += DebugPetWindowOperation(
            mutationSequence.incrementAndGet(),
            operation,
            identity,
            params.x,
            params.y,
            params.width,
            params.height,
        )
    }

    internal fun recordDetachedSurfaceWindowEvent(event: DetachedSurfaceWindowEvent) {
        detachedEvents += event
    }

    private class HeldReminderLiveTimer : ReminderLiveTimer {
        val scheduleCount = AtomicInteger()
        val wakeCount = AtomicInteger()

        override fun schedule(delayMillis: Long, onWake: () -> Unit) {
            scheduleCount.incrementAndGet()
        }

        override fun cancel() = Unit
    }

    private class HeldReminderRecoveryScheduler : ReminderRecoveryScheduler {
        val scheduleRequests = CopyOnWriteArrayList<Long>()
        val cancelCount = AtomicInteger()
        val enabledRequests = CopyOnWriteArrayList<Boolean>()

        override fun schedule(triggerAtMillis: Long) {
            scheduleRequests += triggerAtMillis
        }

        override fun cancel() {
            cancelCount.incrementAndGet()
        }

        override fun setRecoveryEnabled(enabled: Boolean) {
            enabledRequests += enabled
        }
    }
}

internal object PetOverlayDebugHooks {
    @Volatile
    private var installed: PetOverlayDebugControls? = null

    @Synchronized
    fun install(initialNow: Long): PetOverlayDebugControls =
        PetOverlayDebugControls(initialNow).also { installed = it }

    fun current(): PetOverlayDebugControls? = installed

    @Synchronized
    fun clear() {
        installed = null
    }
}
