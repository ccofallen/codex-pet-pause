package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DetachedSurfaceGeometryTest {
    private val screen = Bounds(widthDp = 400, heightDp = 800)

    @Test
    fun rightSidePetOpensSurfaceToTheLeftAndClampsItFullyInsideScreen() {
        val placement = DetachedSurfaceGeometry.place(
            anchor = OverlayPlacement(320, 600, 72, Attachment.Free),
            surface = DetachedSurfaceSize(widthDp = 208, heightDp = 260),
            screen = screen,
        )

        assertEquals(OverlayPlacement(104, 540, 208, Attachment.Free), placement)
    }

    @Test
    fun leftSidePetOpensSurfaceToTheRightWithTheSurfaceGap() {
        val placement = DetachedSurfaceGeometry.place(
            anchor = OverlayPlacement(40, 200, 72, Attachment.Free),
            surface = DetachedSurfaceSize(widthDp = 100, heightDp = 120),
            screen = screen,
        )

        assertEquals(OverlayPlacement(120, 200, 100, Attachment.Free), placement)
    }

    @Test
    fun nearTopAndBottomAnchorsClampTheSurfaceVertically() {
        val nearTop = DetachedSurfaceGeometry.place(
            anchor = OverlayPlacement(200, -20, 72, Attachment.Free),
            surface = DetachedSurfaceSize(widthDp = 100, heightDp = 120),
            screen = screen,
        )
        val nearBottom = DetachedSurfaceGeometry.place(
            anchor = OverlayPlacement(200, 760, 72, Attachment.Free),
            surface = DetachedSurfaceSize(widthDp = 100, heightDp = 120),
            screen = screen,
        )

        assertEquals(0, nearTop.y)
        assertEquals(680, nearBottom.y)
    }

    @Test
    fun oversizedSurfaceIsClampedToTheScreen() {
        val placement = DetachedSurfaceGeometry.place(
            anchor = OverlayPlacement(200, 300, 72, Attachment.Free),
            surface = DetachedSurfaceSize(widthDp = 500, heightDp = 900),
            screen = screen,
        )

        assertEquals(OverlayPlacement(0, 0, 400, Attachment.Free), placement)
    }

    @Test
    fun placingSurfaceDoesNotMutateTheAnchor() {
        val anchor = OverlayPlacement(320, 600, 72, Attachment.Edge(Side.RIGHT))
        val before = anchor.copy()

        DetachedSurfaceGeometry.place(
            anchor = anchor,
            surface = DetachedSurfaceSize(widthDp = 208, heightDp = 260),
            screen = screen,
        )

        assertEquals(before, anchor)
    }

    @Test
    fun detachedSurfaceDimensionsMustBePositive() {
        assertThrows(IllegalArgumentException::class.java) {
            DetachedSurfaceSize(widthDp = 0, heightDp = 100)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DetachedSurfaceSize(widthDp = -1, heightDp = 100)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DetachedSurfaceSize(widthDp = 100, heightDp = 0)
        }
        assertThrows(IllegalArgumentException::class.java) {
            DetachedSurfaceSize(widthDp = 100, heightDp = -1)
        }
    }
}
