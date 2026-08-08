package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OverlayGeometryTest {
    private val geometry = OverlayGeometry(defaultSizeDp = 72)
    private val bounds = Bounds(
        widthDp = 400,
        heightDp = 800,
        safeInsets = SafeInsets(left = 12, top = 24, right = 16, bottom = 32),
    )

    @Test
    fun clampKeepsPetInsideSafeWindow() {
        assertEquals(PointF(12f, 24f), geometry.clamp(PointF(-30f, -5f), bounds))
        assertEquals(PointF(312f, 696f), geometry.clamp(PointF(399f, 799f), bounds))
    }

    @Test
    fun petAwayFromEdgeNeverMovesAutomatically() {
        assertEquals(PointF(200f, 500f), geometry.snapIfInsideZone(PointF(200f, 500f), bounds))
    }

    @Test
    fun petSnapsOnlyWhenDraggedIntoTheEdgeZone() {
        assertEquals(PointF(12f, 200f), geometry.snapIfInsideZone(PointF(30f, 200f), bounds))
        assertEquals(PointF(312f, 200f), geometry.snapIfInsideZone(PointF(310f, 200f), bounds))
        assertEquals(PointF(100f, 24f), geometry.snapIfInsideZone(PointF(100f, 40f), bounds))
        assertEquals(PointF(100f, 696f), geometry.snapIfInsideZone(PointF(100f, 700f), bounds))
    }

    @Test
    fun retractLeavesAtLeastTwentyDpVisibleAndRestoreShowsTheFullPet() {
        val attached = OverlayPlacement(312, 200, 72, Attachment.Edge(Side.RIGHT, retracted = false))

        val retracted = geometry.retract(attached, bounds)
        assertEquals(Attachment.Edge(Side.RIGHT, retracted = true), retracted.attachment)
        assertTrue(geometry.visibleLength(retracted, bounds) >= 20)
        assertEquals(attached, geometry.restore(retracted, bounds))
    }

    @Test
    fun resizeAroundAnchorSupportsSmallMediumAndLargePets() {
        val placement = OverlayPlacement(312, 200, 72, Attachment.Edge(Side.RIGHT, retracted = false))

        assertEquals(OverlayPlacement(328, 200, 56, placement.attachment), geometry.resizeAroundAnchor(placement, 56, bounds))
        assertEquals(OverlayPlacement(288, 200, 96, placement.attachment), geometry.resizeAroundAnchor(placement, 96, bounds))
    }
}
