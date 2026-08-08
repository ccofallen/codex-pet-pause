package io.elevenlabs.codexpetpause.overlay

import kotlin.math.abs

const val DOUBLE_TAP_WINDOW_MS: Long = 250L

enum class MotionAction {
    DOWN,
    POINTER_DOWN,
    MOVE,
    UP,
    POINTER_UP,
    CANCEL,
    WAIT,
}

data class MotionEventSample(
    val action: MotionAction,
    val x: Float = 0f,
    val y: Float = 0f,
    val eventTimeMs: Long,
    val pointerId: Int = 0,
) {
    companion object {
        fun down(x: Float, y: Float, atMs: Long, pointerId: Int = 0) =
            MotionEventSample(MotionAction.DOWN, x, y, atMs, pointerId)

        fun move(x: Float, y: Float, atMs: Long, pointerId: Int = 0) =
            MotionEventSample(MotionAction.MOVE, x, y, atMs, pointerId)

        fun up(x: Float, y: Float, atMs: Long, pointerId: Int = 0) =
            MotionEventSample(MotionAction.UP, x, y, atMs, pointerId)

        fun wait(atMs: Long) = MotionEventSample(MotionAction.WAIT, eventTimeMs = atMs)
    }
}

sealed interface OverlayGestureResult {
    data object NoOp : OverlayGestureResult
    data object OpenMenu : OverlayGestureResult
    data object SingleTap : OverlayGestureResult
    data object Restored : OverlayGestureResult
    data class PlacementChanged(val placement: OverlayPlacement) : OverlayGestureResult
}

val NoOp: OverlayGestureResult = OverlayGestureResult.NoOp
val OpenMenu: OverlayGestureResult = OverlayGestureResult.OpenMenu
val SingleTap: OverlayGestureResult = OverlayGestureResult.SingleTap
val Restored: OverlayGestureResult = OverlayGestureResult.Restored
typealias PlacementChanged = OverlayGestureResult.PlacementChanged

class OverlayGestureInterpreter(
    private val bounds: Bounds,
    private val geometry: OverlayGeometry = OverlayGeometry(),
    initialPlacement: OverlayPlacement,
    private val touchSlopDp: Int = 8,
    internal val doubleTapWindowMs: Long = DOUBLE_TAP_WINDOW_MS,
) {
    var placement: OverlayPlacement = initialPlacement
        private set

    val state: Attachment get() = placement.attachment

    private var activeGesture: ActiveGesture? = null
    private var pendingTapUpAtMs: Long? = null

    init {
        require(touchSlopDp >= 0)
        require(doubleTapWindowMs > 0)
    }

    fun consume(sample: MotionEventSample): OverlayGestureResult {
        return when (sample.action) {
            MotionAction.DOWN -> onDown(sample)
            MotionAction.POINTER_DOWN -> onDown(sample)
            MotionAction.MOVE -> onMove(sample)
            MotionAction.UP -> onUp(sample)
            MotionAction.POINTER_UP -> onUp(sample)
            MotionAction.CANCEL -> onCancel(sample)
            MotionAction.WAIT -> onWait(sample.eventTimeMs)
        }
    }

    private fun onDown(sample: MotionEventSample): OverlayGestureResult {
        if (activeGesture != null) return OverlayGestureResult.NoOp
        val pendingTap = pendingTapUpAtMs
        val elapsedSincePending = pendingTap?.let { sample.eventTimeMs - it }
        val expiredPendingTap = elapsedSincePending != null && elapsedSincePending >= doubleTapWindowMs
        val isSecondTap = elapsedSincePending != null && elapsedSincePending in 0L until doubleTapWindowMs
        if (expiredPendingTap) pendingTapUpAtMs = null
        activeGesture = ActiveGesture(
            pointerId = sample.pointerId,
            startX = sample.x,
            startY = sample.y,
            offsetX = sample.x - placement.x,
            offsetY = sample.y - placement.y,
            initialPlacement = placement,
            isSecondTap = isSecondTap,
        )
        return if (expiredPendingTap) OverlayGestureResult.SingleTap else OverlayGestureResult.NoOp
    }

    private fun onMove(sample: MotionEventSample): OverlayGestureResult {
        val gesture = activeGesture ?: return OverlayGestureResult.NoOp
        if (gesture.pointerId != sample.pointerId) return OverlayGestureResult.NoOp
        val movedFarEnough = abs(sample.x - gesture.startX) > touchSlopDp ||
            abs(sample.y - gesture.startY) > touchSlopDp
        if (!movedFarEnough) return OverlayGestureResult.NoOp
        gesture.dragging = true
        pendingTapUpAtMs = null

        placement = freePlacement(candidateFor(sample, gesture), gesture.initialPlacement.sizeDp)
        return OverlayGestureResult.PlacementChanged(placement)
    }

    private fun onUp(sample: MotionEventSample): OverlayGestureResult {
        val gesture = activeGesture ?: return OverlayGestureResult.NoOp
        if (gesture.pointerId != sample.pointerId) return OverlayGestureResult.NoOp
        activeGesture = null

        if (!gesture.dragging) {
            if (gesture.isSecondTap && pendingTapUpAtMs != null) {
                pendingTapUpAtMs = null
                return OverlayGestureResult.OpenMenu
            }
            val edge = placement.attachment as? Attachment.Edge
            if (edge?.retracted == true && isInsideVisiblePet(sample.x, sample.y)) {
                placement = geometry.restore(placement, bounds)
                pendingTapUpAtMs = null
                return OverlayGestureResult.Restored
            }
            pendingTapUpAtMs = sample.eventTimeMs
            return OverlayGestureResult.NoOp
        }

        val initialEdge = gesture.initialPlacement.attachment as? Attachment.Edge
        val finalCandidate = candidateFor(sample, gesture)
        val finalOutward = initialEdge != null && isOutward(
            initialEdge.side,
            sample.x - gesture.startX,
            sample.y - gesture.startY,
        )
        if (initialEdge?.retracted == true && finalOutward) {
            placement = gesture.initialPlacement
            return OverlayGestureResult.PlacementChanged(placement)
        }
        if (initialEdge != null && finalOutward && !initialEdge.retracted) {
            placement = geometry.retract(gesture.initialPlacement, bounds)
            return OverlayGestureResult.PlacementChanged(placement)
        }
        val side = geometry.sideIfInsideZone(finalCandidate, bounds, gesture.initialPlacement.sizeDp)
        placement = if (side == null) {
            freePlacement(finalCandidate, gesture.initialPlacement.sizeDp)
        } else {
            val snapped = geometry.snapIfInsideZone(finalCandidate, bounds, gesture.initialPlacement.sizeDp)
            OverlayPlacement(
                snapped.x.toInt(),
                snapped.y.toInt(),
                gesture.initialPlacement.sizeDp,
                Attachment.Edge(side, retracted = false),
            )
        }
        return OverlayGestureResult.PlacementChanged(placement)
    }

    private fun onCancel(sample: MotionEventSample): OverlayGestureResult {
        if (activeGesture == null) return OverlayGestureResult.NoOp
        activeGesture = null
        return OverlayGestureResult.NoOp
    }

    private fun onWait(atMs: Long): OverlayGestureResult {
        if (activeGesture?.isSecondTap == true) return OverlayGestureResult.NoOp
        val pending = pendingTapUpAtMs ?: return OverlayGestureResult.NoOp
        if (atMs - pending < doubleTapWindowMs) return OverlayGestureResult.NoOp
        pendingTapUpAtMs = null
        return OverlayGestureResult.SingleTap
    }

    private fun isInsideVisiblePet(x: Float, y: Float): Boolean {
        return x >= placement.x && x <= placement.x + placement.sizeDp &&
            y >= placement.y && y <= placement.y + placement.sizeDp
    }

    private fun isOutward(side: Side, dx: Float, dy: Float): Boolean = when (side) {
        Side.LEFT -> dx < -touchSlopDp
        Side.RIGHT -> dx > touchSlopDp
        Side.TOP -> dy < -touchSlopDp
        Side.BOTTOM -> dy > touchSlopDp
    }

    private fun candidateFor(sample: MotionEventSample, gesture: ActiveGesture): PointF = geometry.clamp(
        PointF(sample.x - gesture.offsetX, sample.y - gesture.offsetY),
        bounds,
        gesture.initialPlacement.sizeDp,
    )

    private fun freePlacement(point: PointF, sizeDp: Int) = OverlayPlacement(
        point.x.toInt(),
        point.y.toInt(),
        sizeDp,
        Attachment.Free,
    )

    private class ActiveGesture(
        val pointerId: Int,
        val startX: Float,
        val startY: Float,
        val offsetX: Float,
        val offsetY: Float,
        val initialPlacement: OverlayPlacement,
        val isSecondTap: Boolean,
        var dragging: Boolean = false,
    )
}
