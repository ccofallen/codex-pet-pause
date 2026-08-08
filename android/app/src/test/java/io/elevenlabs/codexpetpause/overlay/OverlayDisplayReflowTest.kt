package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OverlayDisplayReflowTest {
    private val geometry = OverlayGeometry()

    @Test
    fun rightEdgeAttachmentMovesToCurrentLandscapeSafeBoundary() {
        val portrait = Bounds(
            widthDp = 1080,
            heightDp = 2400,
            safeInsets = SafeInsets(top = 24, bottom = 48),
        )
        val landscape = Bounds(
            widthDp = 2400,
            heightDp = 1080,
            safeInsets = SafeInsets(left = 48, top = 24, right = 60, bottom = 36),
        )
        val attached = OverlayPlacement(
            x = portrait.right - 72,
            y = portrait.bottom - 72,
            sizeDp = 72,
            attachment = Attachment.Edge(Side.RIGHT),
        )

        val reflowed = geometry.reflowForBounds(attached, portrait, landscape)

        assertEquals(landscape.right - 72, reflowed.x)
        assertEquals(landscape.bottom - 72, reflowed.y)
        assertEquals(Attachment.Edge(Side.RIGHT), reflowed.attachment)
        assertTrue(reflowed.x > portrait.right)
    }

    @Test
    fun retractedEdgeKeepsExactly20DpExposedAfterDisplayChange() {
        val portrait = Bounds(1080, 2400, SafeInsets(top = 24, bottom = 48))
        val landscape = Bounds(
            2400,
            1080,
            SafeInsets(left = 48, top = 24, right = 60, bottom = 36),
        )
        val attached = OverlayPlacement(
            x = portrait.right - 72,
            y = portrait.top,
            sizeDp = 72,
            attachment = Attachment.Edge(Side.RIGHT),
        )
        val retracted = geometry.retract(attached, portrait)

        val reflowed = geometry.reflowForBounds(retracted, portrait, landscape)

        assertEquals(landscape.right - 20, reflowed.x)
        assertEquals(20, geometry.visibleLength(reflowed, landscape))
        assertEquals(Attachment.Edge(Side.RIGHT, retracted = true), reflowed.attachment)
    }

    @Test
    fun acceptedPetSizesRemainLiteral56_72_96() {
        assertEquals(listOf(56, 72, 96), PetSize.entries.map(PetSize::sizeDp))
    }
}
