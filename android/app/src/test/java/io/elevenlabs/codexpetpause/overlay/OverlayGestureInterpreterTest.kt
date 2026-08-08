package io.elevenlabs.codexpetpause.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OverlayGestureInterpreterTest {
    private val bounds = Bounds(widthDp = 400, heightDp = 800)
    private val geometry = OverlayGeometry(defaultSizeDp = 72)

    @Test
    fun freePetDoesNotMoveWhileTimePasses() {
        val interpreter = interpreter()
        val before = interpreter.placement

        interpreter.consume(MotionEventSample.wait(atMs = 10_000))

        assertEquals(Attachment.Free, interpreter.state)
        assertEquals(before, interpreter.placement)
    }

    @Test
    fun dragCapturesPointerOffsetInsteadOfJumpingToPointer() {
        val interpreter = interpreter()

        interpreter.consume(MotionEventSample.down(x = 230f, y = 340f, atMs = 0))
        val moved = interpreter.consume(MotionEventSample.move(x = 231f, y = 341f, atMs = 16))

        assertEquals(PlacementChanged(OverlayPlacement(201, 301, 72, Attachment.Free)), moved)
    }

    @Test
    fun dragIntoEdgeZoneAttachesAndFirstOutwardSwipeOnlyPreparesRetractedState() {
        val interpreter = interpreter()

        dragToRightEdge(interpreter, atMs = 0)
        assertEquals(Attachment.Edge(Side.RIGHT, retracted = false), interpreter.state)

        interpreter.consume(MotionEventSample.wait(atMs = 10_000))
        assertEquals(Attachment.Edge(Side.RIGHT, retracted = false), interpreter.state)

        outwardSwipe(interpreter, atMs = 11_000)
        assertEquals(Attachment.Edge(Side.RIGHT, retracted = true), interpreter.state)
    }

    @Test
    fun inwardDragFromAttachedEdgeMakesPetFree() {
        val interpreter = interpreter()
        dragToRightEdge(interpreter, atMs = 0)

        interpreter.consume(MotionEventSample.down(x = 350f, y = 340f, atMs = 1_000))
        interpreter.consume(MotionEventSample.move(x = 280f, y = 340f, atMs = 1_016))
        interpreter.consume(MotionEventSample.up(x = 280f, y = 340f, atMs = 1_032))

        assertTrue(interpreter.state is Attachment.Free)
    }

    @Test
    fun tappingExposedPetRestoresIt() {
        val interpreter = interpreter()
        dragToRightEdge(interpreter, atMs = 0)
        outwardSwipe(interpreter, atMs = 1_000)

        val result = tap(interpreter, x = 395f, y = 340f, atMs = 2_000)

        assertEquals(Restored, result)
        assertEquals(Attachment.Edge(Side.RIGHT, retracted = false), interpreter.state)
    }

    @Test
    fun doubleTapWithin250MillisecondsOpensMenu() {
        val interpreter = interpreter()

        tap(interpreter, x = 200f, y = 340f, atMs = 0)
        val result = tap(interpreter, x = 200f, y = 340f, atMs = 180)

        assertEquals(OpenMenu, result)
    }

    @Test
    fun singleTapIsEmittedWhenDoubleTapWindowEnds() {
        val interpreter = interpreter()

        tap(interpreter, x = 200f, y = 340f, atMs = 0)
        val result = interpreter.consume(MotionEventSample.wait(atMs = 251))

        assertEquals(SingleTap, result)
    }

    private fun interpreter() = OverlayGestureInterpreter(
        bounds = bounds,
        geometry = geometry,
        initialPlacement = OverlayPlacement(200, 300, 72, Attachment.Free),
        touchSlopDp = 8,
        doubleTapWindowMs = 250,
    )

    private fun dragToRightEdge(interpreter: OverlayGestureInterpreter, atMs: Long) {
        interpreter.consume(MotionEventSample.down(x = 230f, y = 340f, atMs = atMs))
        interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = atMs + 16))
        interpreter.consume(MotionEventSample.up(x = 390f, y = 340f, atMs = atMs + 32))
    }

    private fun outwardSwipe(interpreter: OverlayGestureInterpreter, atMs: Long) {
        interpreter.consume(MotionEventSample.down(x = 350f, y = 340f, atMs = atMs))
        interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = atMs + 16))
        interpreter.consume(MotionEventSample.up(x = 390f, y = 340f, atMs = atMs + 32))
    }

    private fun tap(interpreter: OverlayGestureInterpreter, x: Float, y: Float, atMs: Long): OverlayGestureResult {
        interpreter.consume(MotionEventSample.down(x = x, y = y, atMs = atMs))
        return interpreter.consume(MotionEventSample.up(x = x, y = y, atMs = atMs + 16))
    }
}
