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
        val moved = interpreter.consume(MotionEventSample.move(x = 239f, y = 340f, atMs = 16))

        assertEquals(PlacementChanged(OverlayPlacement(209, 300, 72, Attachment.Free)), moved)
    }

    @Test
    fun moveStaysFreeAndOnlyActivePointerUpSnapsIntoTheEdgeZone() {
        val interpreter = interpreter()

        interpreter.consume(MotionEventSample.down(x = 230f, y = 340f, atMs = 0))
        val moved = interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = 16))

        assertEquals(PlacementChanged(OverlayPlacement(328, 300, 72, Attachment.Free)), moved)
        assertEquals(Attachment.Free, interpreter.state)
        assertEquals(
            PlacementChanged(OverlayPlacement(328, 300, 72, Attachment.Edge(Side.RIGHT, retracted = false))),
            interpreter.consume(MotionEventSample.up(x = 390f, y = 340f, atMs = 32)),
        )
    }

    @Test
    fun attachedNineDpInwardMoveDetachesUntilUpMayResnapInTheZone() {
        val interpreter = interpreter()
        dragToRightEdge(interpreter, atMs = 0)

        interpreter.consume(MotionEventSample.down(x = 350f, y = 340f, atMs = 1_000))
        val moved = interpreter.consume(MotionEventSample.move(x = 341f, y = 340f, atMs = 1_016))

        assertEquals(PlacementChanged(OverlayPlacement(319, 300, 72, Attachment.Free)), moved)
        assertEquals(Attachment.Free, interpreter.state)
        assertEquals(
            PlacementChanged(OverlayPlacement(328, 300, 72, Attachment.Edge(Side.RIGHT, retracted = false))),
            interpreter.consume(MotionEventSample.up(x = 341f, y = 340f, atMs = 1_032)),
        )
    }

    @Test
    fun outwardThenFinalInwardMovementKeepsTheFinalFreeCandidate() {
        val interpreter = interpreter()
        dragToRightEdge(interpreter, atMs = 0)

        interpreter.consume(MotionEventSample.down(x = 350f, y = 340f, atMs = 1_000))
        interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = 1_016))
        val movedInward = interpreter.consume(MotionEventSample.move(x = 300f, y = 340f, atMs = 1_032))

        assertEquals(PlacementChanged(OverlayPlacement(278, 300, 72, Attachment.Free)), movedInward)
        assertEquals(
            PlacementChanged(OverlayPlacement(278, 300, 72, Attachment.Free)),
            interpreter.consume(MotionEventSample.up(x = 300f, y = 340f, atMs = 1_048)),
        )
        assertEquals(Attachment.Free, interpreter.state)
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
        val result = interpreter.consume(MotionEventSample.wait(atMs = 267))

        assertEquals(SingleTap, result)
    }

    @Test
    fun expiredPendingTapIsSettledWhenNewDownArrivesAndNewUpCanPendAgain() {
        val interpreter = interpreter()
        tap(interpreter, x = 200f, y = 340f, atMs = 0)

        assertEquals(SingleTap, interpreter.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 267)))
        assertEquals(NoOp, interpreter.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 283)))
        assertEquals(SingleTap, interpreter.consume(MotionEventSample.wait(atMs = 534)))
    }

    @Test
    fun doubleTapWindowTreats249And250AsDoubleTapAnd251AsSingleTap() {
        val at249 = interpreter()
        tap(at249, x = 200f, y = 340f, atMs = 0)
        assertEquals(NoOp, at249.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 265)))
        assertEquals(OpenMenu, at249.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 281)))

        val at250 = interpreter()
        tap(at250, x = 200f, y = 340f, atMs = 0)
        assertEquals(NoOp, at250.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 266)))
        assertEquals(OpenMenu, at250.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 282)))

        val at251 = interpreter()
        tap(at251, x = 200f, y = 340f, atMs = 0)
        assertEquals(SingleTap, at251.consume(MotionEventSample.down(x = 200f, y = 340f, atMs = 267)))
        assertEquals(NoOp, at251.consume(MotionEventSample.up(x = 200f, y = 340f, atMs = 283)))
    }

    @Test
    fun secondPointerCannotReplaceOrFinishTheActivePointerGesture() {
        val interpreter = interpreter()

        interpreter.consume(MotionEventSample.down(x = 230f, y = 340f, atMs = 0, pointerId = 0))
        assertEquals(
            NoOp,
            interpreter.consume(MotionEventSample(MotionAction.POINTER_DOWN, x = 390f, y = 340f, eventTimeMs = 8, pointerId = 1)),
        )
        assertEquals(
            NoOp,
            interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = 16, pointerId = 1)),
        )
        assertEquals(
            NoOp,
            interpreter.consume(MotionEventSample(MotionAction.POINTER_UP, x = 390f, y = 340f, eventTimeMs = 24, pointerId = 1)),
        )
        assertEquals(
            PlacementChanged(OverlayPlacement(209, 300, 72, Attachment.Free)),
            interpreter.consume(MotionEventSample.move(x = 239f, y = 340f, atMs = 32, pointerId = 0)),
        )
    }

    @Test
    fun activePointerCancelKeepsLastSafePlacementWithoutTapSnapOrRetraction() {
        val interpreter = interpreter()
        dragToRightEdge(interpreter, atMs = 0)

        interpreter.consume(MotionEventSample.down(x = 350f, y = 340f, atMs = 1_000, pointerId = 0))
        interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = 1_016, pointerId = 0))
        assertEquals(NoOp, interpreter.consume(MotionEventSample(MotionAction.CANCEL, eventTimeMs = 1_032, pointerId = 0)))

        assertEquals(Attachment.Free, interpreter.state)
        assertEquals(OverlayPlacement(328, 300, 72, Attachment.Free), interpreter.placement)
        assertEquals(NoOp, interpreter.consume(MotionEventSample.wait(atMs = 2_000)))
    }

    @Test
    fun cancelAlwaysClearsActiveGestureRegardlessOfCancelPointerId() {
        val interpreter = interpreter()
        dragToRightEdge(interpreter, atMs = 0)

        interpreter.consume(MotionEventSample.down(x = 350f, y = 340f, atMs = 1_000, pointerId = 7))
        interpreter.consume(MotionEventSample.move(x = 390f, y = 340f, atMs = 1_016, pointerId = 7))
        assertEquals(NoOp, interpreter.consume(MotionEventSample(MotionAction.CANCEL, eventTimeMs = 1_032)))
        assertEquals(OverlayPlacement(328, 300, 72, Attachment.Free), interpreter.placement)

        assertEquals(NoOp, interpreter.consume(MotionEventSample.move(x = 300f, y = 340f, atMs = 1_048, pointerId = 7)))
        assertEquals(NoOp, interpreter.consume(MotionEventSample.up(x = 300f, y = 340f, atMs = 1_064, pointerId = 7)))
        assertEquals(OverlayPlacement(328, 300, 72, Attachment.Free), interpreter.placement)
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
