package io.elevenlabs.codexpetpause.overlay

import kotlin.math.roundToInt

const val MIN_VISIBLE_DP: Int = 20

data class PointF(val x: Float, val y: Float)

data class SafeInsets(
    val left: Int = 0,
    val top: Int = 0,
    val right: Int = 0,
    val bottom: Int = 0,
)

data class Bounds(
    val widthDp: Int,
    val heightDp: Int,
    val safeInsets: SafeInsets = SafeInsets(),
) {
    init {
        require(widthDp >= 0 && heightDp >= 0)
        require(safeInsets.left >= 0 && safeInsets.top >= 0)
        require(safeInsets.right >= 0 && safeInsets.bottom >= 0)
        require(safeInsets.left + safeInsets.right < widthDp)
        require(safeInsets.top + safeInsets.bottom < heightDp)
        require(widthDp - safeInsets.left - safeInsets.right >= MIN_VISIBLE_DP)
        require(heightDp - safeInsets.top - safeInsets.bottom >= MIN_VISIBLE_DP)
    }

    val left: Int get() = safeInsets.left
    val top: Int get() = safeInsets.top
    val right: Int get() = widthDp - safeInsets.right
    val bottom: Int get() = heightDp - safeInsets.bottom
}

enum class Side {
    LEFT,
    RIGHT,
    TOP,
    BOTTOM,
}

enum class PetSize(val sizeDp: Int) {
    SMALL(56),
    MEDIUM(72),
    LARGE(96),
}

sealed interface Attachment {
    data object Free : Attachment

    data class Edge(val side: Side, val retracted: Boolean = false) : Attachment
}

data class OverlayPlacement(
    val x: Int,
    val y: Int,
    val sizeDp: Int,
    val attachment: Attachment,
)

class OverlayGeometry(
    private val edgeZoneDp: Int = 24,
    private val minVisibleDp: Int = MIN_VISIBLE_DP,
    val defaultSizeDp: Int = PetSize.MEDIUM.sizeDp,
) {
    init {
        require(edgeZoneDp >= 0)
        require(minVisibleDp >= MIN_VISIBLE_DP)
        require(defaultSizeDp >= minVisibleDp)
    }

    fun clamp(point: PointF, bounds: Bounds, sizeDp: Int = defaultSizeDp): PointF {
        require(sizeDp >= minVisibleDp)
        return PointF(
            point.x.coerceIn(bounds.left.toFloat(), maxX(bounds, sizeDp).toFloat()),
            point.y.coerceIn(bounds.top.toFloat(), maxY(bounds, sizeDp).toFloat()),
        )
    }

    fun snapIfInsideZone(point: PointF, bounds: Bounds, sizeDp: Int = defaultSizeDp): PointF {
        val side = sideIfInsideZone(point, bounds, sizeDp) ?: return clamp(point, bounds, sizeDp)
        return fullEdgePoint(point, side, bounds, sizeDp)
    }

    fun sideIfInsideZone(point: PointF, bounds: Bounds, sizeDp: Int = defaultSizeDp): Side? {
        require(sizeDp > 0)
        val candidates = listOfNotNull(
            (point.x - bounds.left).takeIf { it <= edgeZoneDp.toFloat() }?.let { it to Side.LEFT },
            (bounds.right - (point.x + sizeDp)).takeIf { it <= edgeZoneDp.toFloat() }?.let { it to Side.RIGHT },
            (point.y - bounds.top).takeIf { it <= edgeZoneDp.toFloat() }?.let { it to Side.TOP },
            (bounds.bottom - (point.y + sizeDp)).takeIf { it <= edgeZoneDp.toFloat() }?.let { it to Side.BOTTOM },
        )
        return candidates.minByOrNull { it.first }?.second
    }

    fun retract(placement: OverlayPlacement, bounds: Bounds): OverlayPlacement {
        val edge = placement.attachment as? Attachment.Edge
            ?: return placement
        val full = fullEdgePoint(PointF(placement.x.toFloat(), placement.y.toFloat()), edge.side, bounds, placement.sizeDp)
        val retractedPoint = when (edge.side) {
            Side.LEFT -> full.copy(x = (bounds.left - placement.sizeDp + minVisibleDp).toFloat())
            Side.RIGHT -> full.copy(x = (bounds.right - minVisibleDp).toFloat())
            Side.TOP -> full.copy(y = (bounds.top - placement.sizeDp + minVisibleDp).toFloat())
            Side.BOTTOM -> full.copy(y = (bounds.bottom - minVisibleDp).toFloat())
        }
        return OverlayPlacement(
            retractedPoint.x.roundToInt(),
            retractedPoint.y.roundToInt(),
            placement.sizeDp,
            Attachment.Edge(edge.side, retracted = true),
        )
    }

    fun restore(placement: OverlayPlacement, bounds: Bounds): OverlayPlacement {
        val edge = placement.attachment as? Attachment.Edge ?: return placement
        val point = fullEdgePoint(PointF(placement.x.toFloat(), placement.y.toFloat()), edge.side, bounds, placement.sizeDp)
        return OverlayPlacement(
            point.x.roundToInt(),
            point.y.roundToInt(),
            placement.sizeDp,
            Attachment.Edge(edge.side, retracted = false),
        )
    }

    fun resizeAroundAnchor(placement: OverlayPlacement, newSizeDp: Int, bounds: Bounds): OverlayPlacement {
        require(newSizeDp >= minVisibleDp)
        val edge = placement.attachment as? Attachment.Edge
        if (edge != null) {
            val resized = placement.copy(sizeDp = newSizeDp, attachment = Attachment.Edge(edge.side, false))
            return if (edge.retracted) retract(resized, bounds) else restore(resized, bounds)
        }

        val center = PointF(
            placement.x + placement.sizeDp / 2f,
            placement.y + placement.sizeDp / 2f,
        )
        val point = clamp(
            PointF(center.x - newSizeDp / 2f, center.y - newSizeDp / 2f),
            bounds,
            newSizeDp,
        )
        return OverlayPlacement(point.x.roundToInt(), point.y.roundToInt(), newSizeDp, Attachment.Free)
    }

    fun visibleLength(placement: OverlayPlacement, bounds: Bounds): Int {
        val edge = placement.attachment as? Attachment.Edge ?: return placement.sizeDp
        return when (edge.side) {
            Side.LEFT -> (placement.x + placement.sizeDp - bounds.left).coerceIn(0, placement.sizeDp)
            Side.RIGHT -> (bounds.right - placement.x).coerceIn(0, placement.sizeDp)
            Side.TOP -> (placement.y + placement.sizeDp - bounds.top).coerceIn(0, placement.sizeDp)
            Side.BOTTOM -> (bounds.bottom - placement.y).coerceIn(0, placement.sizeDp)
        }
    }

    private fun fullEdgePoint(point: PointF, side: Side, bounds: Bounds, sizeDp: Int): PointF {
        val clamped = clamp(point, bounds, sizeDp)
        return when (side) {
            Side.LEFT -> PointF(bounds.left.toFloat(), clamped.y)
            Side.RIGHT -> PointF(maxX(bounds, sizeDp).toFloat(), clamped.y)
            Side.TOP -> PointF(clamped.x, bounds.top.toFloat())
            Side.BOTTOM -> PointF(clamped.x, maxY(bounds, sizeDp).toFloat())
        }
    }

    private fun maxX(bounds: Bounds, sizeDp: Int): Int = maxOf(bounds.left, bounds.right - sizeDp)

    private fun maxY(bounds: Bounds, sizeDp: Int): Int = maxOf(bounds.top, bounds.bottom - sizeDp)
}
