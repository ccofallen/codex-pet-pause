package io.elevenlabs.codexpetpause.overlay

import kotlin.math.abs

enum class MotionAction {
    DOWN,
    MOVE,
    UP,
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
    private val doubleTapWindowMs: Long = 250,
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
            MotionAction.MOVE -> onMove(sample)
            MotionAction.UP -> onUp(sample)
            MotionAction.CANCEL -> {
                activeGesture = null
                OverlayGestureResult.NoOp
            }
            MotionAction.WAIT -> onWait(sample.eventTimeMs)
        }
    }

    private fun onDown(sample: MotionEventSample): OverlayGestureResult {
        val pendingTap = pendingTapUpAtMs
        val isSecondTap = pendingTap != null && sample.eventTimeMs - pendingTap <= doubleTapWindowMs
        activeGesture = ActiveGesture(
            pointerId = sample.pointerId,
            startX = sample.x,
            startY = sample.y,
            offsetX = sample.x - placement.x,
            offsetY = sample.y - placement.y,
            initialPlacement = placement,
            isSecondTap = isSecondTap,
        )
        return OverlayGestureResult.NoOp
    }

    private fun onMove(sample: MotionEventSample): OverlayGestureResult {
        val gesture = activeGesture ?: return OverlayGestureResult.NoOp
        if (gesture.pointerId != sample.pointerId) return OverlayGestureResult.NoOp
        val movedFarEnough = abs(sample.x - gesture.startX) > touchSlopDp ||
            abs(sample.y - gesture.startY) > touchSlopDp
        if (!movedFarEnough) return OverlayGestureResult.NoOp
        gesture.dragging = true
        pendingTapUpAtMs = null

        val initialEdge = gesture.initialPlacement.attachment as? Attachment.Edge
        if (initialEdge != null) {
            if (isOutward(initialEdge.side, sample.x - gesture.startX, sample.y - gesture.startY)) {
                gesture.outward = true
                return OverlayGestureResult.NoOp
            }
        }

        val candidate = geometry.clamp(
            PointF(sample.x - gesture.offsetX, sample.y - gesture.offsetY),
            bounds,
            gesture.initialPlacement.sizeDp,
        )
        val side = geometry.sideIfInsideZone(candidate, bounds, gesture.initialPlacement.sizeDp)
        placement = if (side == null) {
            OverlayPlacement(
                candidate.x.toInt(),
                candidate.y.toInt(),
                gesture.initialPlacement.sizeDp,
                Attachment.Free,
            )
        } else {
            val snapped = geometry.snapIfInsideZone(candidate, bounds, gesture.initialPlacement.sizeDp)
            OverlayPlacement(
                snapped.x.toInt(),
                snapped.y.toInt(),
                gesture.initialPlacement.sizeDp,
                Attachment.Edge(side, retracted = false),
            )
        }
        return OverlayGestureResult.PlacementChanged(placement)
    }

    private fun onUp(sample: MotionEventSample): OverlayGestureResult {
        val gesture = activeGesture ?: return OverlayGestureResult.NoOp
        activeGesture = null
        if (gesture.pointerId != sample.pointerId) return OverlayGestureResult.NoOp

        if (!gesture.dragging) {
            if (gesture.isSecondTap && pendingTapUpAtMs != null &&
                sample.eventTimeMs - pendingTapUpAtMs!! <= doubleTapWindowMs
            ) {
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
        if (initialEdge != null && gesture.outward && !initialEdge.retracted) {
            placement = geometry.retract(gesture.initialPlacement, bounds)
            return OverlayGestureResult.PlacementChanged(placement)
        }
        return OverlayGestureResult.PlacementChanged(placement)
    }

    private fun onWait(atMs: Long): OverlayGestureResult {
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

    private class ActiveGesture(
        val pointerId: Int,
        val startX: Float,
        val startY: Float,
        val offsetX: Float,
        val offsetY: Float,
        val initialPlacement: OverlayPlacement,
        val isSecondTap: Boolean,
        var dragging: Boolean = false,
        var outward: Boolean = false,
    )
}
