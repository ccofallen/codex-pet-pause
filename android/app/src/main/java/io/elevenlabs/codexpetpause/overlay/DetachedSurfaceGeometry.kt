package io.elevenlabs.codexpetpause.overlay

enum class DetachedSurfaceSide {
    LEFT,
    RIGHT,
}

data class DetachedSurfaceSize(
    val widthDp: Int,
    val heightDp: Int,
) {
    init {
        require(widthDp > 0)
        require(heightDp > 0)
    }
}

object DetachedSurfaceGeometry {
    const val SURFACE_GAP_DP: Int = 8

    fun place(
        anchor: OverlayPlacement,
        surface: DetachedSurfaceSize,
        screen: Bounds,
    ): OverlayPlacement {
        val availableWidth = screen.right - screen.left
        val availableHeight = screen.bottom - screen.top
        val surfaceWidth = surface.widthDp.coerceAtMost(availableWidth)
        val surfaceHeight = surface.heightDp.coerceAtMost(availableHeight)
        val side = if (petCenterX(anchor) > screen.widthDp / 2f) {
            DetachedSurfaceSide.LEFT
        } else {
            DetachedSurfaceSide.RIGHT
        }
        val proposedX = when (side) {
            DetachedSurfaceSide.LEFT -> anchor.x - SURFACE_GAP_DP - surfaceWidth
            DetachedSurfaceSide.RIGHT -> anchor.x + anchor.sizeDp + SURFACE_GAP_DP
        }
        val x = proposedX.coerceIn(screen.left, screen.right - surfaceWidth)
        val y = anchor.y.coerceIn(screen.top, screen.bottom - surfaceHeight)

        return OverlayPlacement(x, y, surfaceWidth, Attachment.Free)
    }

    private fun petCenterX(anchor: OverlayPlacement): Float =
        anchor.x + anchor.sizeDp / 2f
}
