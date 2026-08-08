package io.elevenlabs.codexpetpause

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.Settings
import android.view.InputDevice
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.core.content.ContextCompat
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.elevenlabs.codexpetpause.overlay.AndroidServiceLifecycle
import io.elevenlabs.codexpetpause.overlay.PetOverlayService
import java.util.Locale
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OverlayGestureTest {
    @Before
    fun setUp() {
        DeviceQa.reset()
        DeviceQa.grantNotifications()
    }

    @After
    fun tearDown() {
        DeviceQa.stopService()
        DeviceQa.restoreRotation()
    }

    @Test
    fun firstRunOverlayDismissRetryResumeAndActivityDetach() {
        DeviceQa.setOverlayPermission(false)
        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
            DeviceQa.awaitText("Phone status", "手机状态")
            DeviceQa.clickText("Enable floating pet", "启用悬浮宠物")
            DeviceQa.awaitText("Allow the pet to appear over other apps", "允许宠物显示在其他应用上层")
            DeviceQa.clickText("Open permission settings", "前往授权")
            DeviceQa.awaitSystemSettings()
            DeviceQa.pressBack()
            DeviceQa.awaitText("Retry permission", "重新授权")
            assertFalse(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().petVisible)

            DeviceQa.clickText("Retry permission", "重新授权")
            DeviceQa.awaitText("Allow the pet to appear over other apps", "允许宠物显示在其他应用上层")
            DeviceQa.clickText("Open permission settings", "前往授权")
            DeviceQa.awaitSystemSettings()
            DeviceQa.setOverlayPermission(true)
            DeviceQa.pressBack()
            DeviceQa.awaitText("The floating pet is visible", "悬浮宠物正在显示")
            assertEquals(1, DeviceQa.overlayWindows().size)
        } finally {
            scenario.close()
        }

        DeviceQa.awaitCondition("settings Activity should detach") {
            DeviceQa.fullScreenTargetWindows().isEmpty()
        }
        assertEquals(1, DeviceQa.overlayWindows().size)
        assertTrue(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().serviceActive)
        assertTrue(DeviceQa.hasForegroundServiceNotification())
    }


    @Test
    fun transparentSizesDragSnapRetractRestoreAndIdle() {
        DeviceQa.setOverlayPermission(true)
        listOf("small" to 56, "medium" to 72, "large" to 96).forEach { (size, expectedDp) ->
            DeviceQa.stopService()
            DeviceQa.seedState(petSize = size)
            DeviceQa.startService(PetOverlayService.START)
            val bounds = DeviceQa.awaitOverlay()
            assertTrue(abs(bounds.width() - DeviceQa.dp(expectedDp)) <= DeviceQa.dp(3))
            assertTrue(abs(bounds.height() - DeviceQa.dp(expectedDp)) <= DeviceQa.dp(3))
            assertTrue(bounds.width() < DeviceQa.screenBounds().width() / 2)
            assertEquals(1, DeviceQa.overlayWindows().size)
        }

        DeviceQa.stopService()
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)
        val initial = DeviceQa.awaitOverlay()
        SystemClock.sleep(5_100)
        assertEquals(initial, DeviceQa.awaitOverlay())

        val screen = DeviceQa.screenBounds()
        val pointerOffset = DeviceQa.dp(14)
        DeviceQa.drag(Point(initial.left + pointerOffset, initial.centerY()), Point(screen.right - 2, initial.centerY()))
        val attached = DeviceQa.awaitOverlayChange(initial)
        assertTrue(abs(attached.right - screen.right) <= DeviceQa.dp(3))
        SystemClock.sleep(5_100)
        assertEquals(attached, DeviceQa.awaitOverlay())

        DeviceQa.drag(Point(attached.centerX(), attached.centerY()), Point(screen.right - 1, attached.centerY()))
        val retracted = DeviceQa.awaitOverlayChange(attached)
        assertTrue(abs(retracted.width() - DeviceQa.dp(20)) <= DeviceQa.dp(4))

        DeviceQa.tap(Point(retracted.centerX(), retracted.centerY()))
        val restored = DeviceQa.awaitOverlayChange(retracted)
        assertTrue(abs(restored.width() - DeviceQa.dp(72)) <= DeviceQa.dp(3))

        val end = Point(screen.centerX(), screen.centerY())
        DeviceQa.drag(Point(restored.left + pointerOffset, restored.centerY()), end)
        val detached = DeviceQa.awaitOverlayChange(restored)
        assertTrue(abs(detached.left - (end.x - pointerOffset)) <= DeviceQa.dp(4))
        assertTrue(detached.right < screen.right - DeviceQa.dp(24))
    }

    @Test
    fun doubleTapMenuSettingsHideAndQuitHaveSinglePetSemantics() {
        DeviceQa.setOverlayPermission(true)
        DeviceQa.seedState()
        DeviceQa.startService(PetOverlayService.START)

        DeviceQa.openOverlayMenu()
        DeviceQa.clickText("Settings", "设置")
        DeviceQa.awaitCondition("settings Activity should open") { DeviceQa.fullScreenTargetWindows().size == 1 }
        assertEquals(1, DeviceQa.overlayWindows().size)
        DeviceQa.pressBack()

        DeviceQa.openOverlayMenu()
        DeviceQa.clickText("Hide", "隐藏")
        DeviceQa.awaitCondition("hide should remove the pet") { DeviceQa.overlayWindows().isEmpty() }
        assertTrue(AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot().serviceActive)
        assertTrue(DeviceQa.hasForegroundServiceNotification())

        DeviceQa.startService(PetOverlayService.SHOW)
        DeviceQa.openOverlayMenu()
        DeviceQa.clickText("Quit", "退出")
        DeviceQa.awaitCondition("quit should remove pet and notification") {
            DeviceQa.overlayWindows().isEmpty() && !DeviceQa.hasForegroundServiceNotification()
        }
        val quit = AndroidServiceLifecycle.forContext(DeviceQa.context).snapshot()
        assertTrue(quit.quitRequested)
        assertFalse(quit.serviceActive)
    }

    @Test
    fun phoneLayoutTouchTargetsBilingualCopyAndNoDuplicateActivityPet() {
        DeviceQa.seedState(locale = "en")
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            DeviceQa.awaitText("Phone navigation")
            listOf("Companion", "Reminders", "Pet", "Settings").forEach(DeviceQa::assertTouchTarget)
            assertTrue(DeviceQa.overlayWindows().isEmpty())
            scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
            DeviceQa.awaitCondition("landscape Activity should remain usable") {
                DeviceQa.fullScreenTargetWindows().size == 1
            }
            DeviceQa.assertTouchTarget("Settings")
        }

        DeviceQa.seedState(locale = "zh-CN")
        ActivityScenario.launch(MainActivity::class.java).use {
            DeviceQa.awaitText("手机导航")
            DeviceQa.assertTouchTarget("设置")
        }
        val en = DeviceQa.localizedContext(Locale.ENGLISH)
        val zh = DeviceQa.localizedContext(Locale.SIMPLIFIED_CHINESE)
        assertEquals("Show pet", en.getString(R.string.overlay_action_show))
        assertEquals("显示宠物", zh.getString(R.string.overlay_action_show))
        assertEquals("Quit", en.getString(R.string.overlay_action_quit))
        assertEquals("退出", zh.getString(R.string.overlay_action_quit))
    }
}

internal object DeviceQa {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context: Context = instrumentation.targetContext
    private val automation = instrumentation.uiAutomation.apply {
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
    }

    fun reset() {
        stopService()
        context.getSharedPreferences("android-overlay-lifecycle", Context.MODE_PRIVATE).edit().clear().commit()
        context.filesDir.resolve("state.json").delete()
        context.filesDir.resolve("pets").deleteRecursively()
        context.cacheDir.resolve("pending-pet-archives").deleteRecursively()
        context.getSystemService(NotificationManager::class.java).cancelAll()
        setOverlayPermission(false)
    }

    fun seedState(
        petSize: String = "medium",
        locale: String = "en",
        soundEnabled: Boolean = true,
        reminders: JSONArray = defaultReminders(),
    ) {
        val settings = JSONObject()
            .put("schemaVersion", 5).put("locale", locale).put("onboardingComplete", true)
            .put("theme", "system").put("petSize", petSize).put("soundEnabled", soundEnabled)
            .put("animationsEnabled", true).put("affinity", 0)
            .put("quietHours", JSONObject().put("enabled", false).put("startMinutes", 1320).put("endMinutes", 420))
            .put("runtime", JSONObject()).put("cat", JSONObject().put("name", "Momo"))
            .put("activePetId", "builtin-cat")
            .put("petPosition", JSONObject().put("xRatio", 0.82).put("yRatio", 0.72))
            .put("reminders", reminders)
        val snapshot = JSONObject().put("schemaVersion", 1).put("settingsJson", settings.toString())
            .put("historyJson", JSONArray()).put("pets", JSONArray())
            .put("overlay", JSONObject().put("xRatio", 0.62).put("yRatio", 0.48))
        context.filesDir.resolve("state.json").writeText(snapshot.toString())
    }

    fun defaultReminders(now: Long = System.currentTimeMillis()) = JSONArray().apply {
        put(reminder("lookAway", "lookAway", false, 20, now + 1_200_000L))
        put(reminder("drinkWater", "drinkWater", false, 45, now + 2_700_000L))
        put(reminder("standUp", "standUp", false, 60, now + 3_600_000L))
        put(reminder("takeBreak", "takeBreak", false, 90, now + 5_400_000L))
    }

    fun reminder(id: String, type: String, enabled: Boolean, minutes: Int, dueAt: Long) = JSONObject()
        .put("id", id).put("kind", "preset").put("type", type).put("enabled", enabled)
        .put("intervalMinutes", minutes).put("nextDueAt", dueAt)
        .put("status", if (enabled) "scheduled" else "disabled")

    fun setOverlayPermission(allowed: Boolean) {
        shell("appops set ${context.packageName} SYSTEM_ALERT_WINDOW ${if (allowed) "allow" else "deny"}")
        awaitCondition("overlay app-op did not change") { Settings.canDrawOverlays(context) == allowed }
    }

    fun grantNotifications() {
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
    }


    fun startService(action: String) = ContextCompat.startForegroundService(
        context,
        Intent(context, PetOverlayService::class.java).setAction(action),
    )

    fun stopService() {
        context.stopService(Intent(context, PetOverlayService::class.java))
        SystemClock.sleep(150)
    }

    fun awaitOverlay(): Rect {
        var result: Rect? = null
        awaitCondition("floating overlay should be visible") {
            result = overlayWindows().singleOrNull()
            result != null
        }
        return requireNotNull(result)
    }

    fun awaitOverlayChange(previous: Rect): Rect {
        var result: Rect? = null
        awaitCondition("floating overlay bounds should change") {
            result = overlayWindows().singleOrNull()
            result != null && result != previous
        }
        return requireNotNull(result)
    }

    fun overlayWindows(): List<Rect> {
        val screen = screenBounds()
        return targetWindows().filter {
            it.type == AccessibilityWindowInfo.TYPE_SYSTEM ||
                (it.bounds.width() < screen.width() * 3 / 4 && it.bounds.height() < screen.height() * 3 / 4)
        }.map { Rect(it.bounds) }
    }

    fun fullScreenTargetWindows(): List<Rect> {
        val screen = screenBounds()
        return targetWindows().map { it.bounds }.filter {
            it.width() >= screen.width() * 3 / 4 && it.height() >= screen.height() * 3 / 4
        }
    }

    fun screenBounds(): Rect {
        val manager = context.getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= 30) return Rect(manager.maximumWindowMetrics.bounds)
        @Suppress("DEPRECATION")
        return Point().also { manager.defaultDisplay.getRealSize(it) }.let { Rect(0, 0, it.x, it.y) }
    }

    fun safeScreenBounds(): Rect {
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = context.getSystemService(WindowManager::class.java).currentWindowMetrics
            val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
            )
            val bounds = metrics.bounds
            return Rect(
                bounds.left + insets.left,
                bounds.top + insets.top,
                bounds.right - insets.right,
                bounds.bottom - insets.bottom,
            )
        }
        return screenBounds()
    }

    fun openOverlayMenu() {
        val pet = awaitOverlay()
        doubleTap(Point(pet.centerX(), pet.centerY()))
        awaitText("Settings", "设置")
    }

    fun tap(point: Point) = gesture(point, point, 70)
    fun doubleTap(point: Point) { tap(point); SystemClock.sleep(90); tap(point) }
    fun drag(from: Point, to: Point) = gesture(from, to, 420)

    private fun gesture(from: Point, to: Point, durationMs: Long) {
        val down = SystemClock.uptimeMillis()
        inject(MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, from.x.toFloat(), from.y.toFloat(), 0))
        repeat(12) { index ->
            val fraction = (index + 1) / 12f
            inject(MotionEvent.obtain(down, down + (durationMs * fraction).toLong(), MotionEvent.ACTION_MOVE,
                from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction, 0))
        }
        inject(MotionEvent.obtain(down, down + durationMs, MotionEvent.ACTION_UP, to.x.toFloat(), to.y.toFloat(), 0))
    }

    private fun inject(event: MotionEvent) {
        event.source = InputDevice.SOURCE_TOUCHSCREEN
        try { assertTrue(automation.injectInputEvent(event, true)) } finally { event.recycle() }
    }

    fun awaitText(vararg labels: String): AccessibilityNodeInfo {
        var result: AccessibilityNodeInfo? = null
        awaitCondition("expected text was not visible: ${labels.toList()}") {
            result = labels.firstNotNullOfOrNull(::findNode)
            result != null
        }
        return requireNotNull(result)
    }

    fun clickText(vararg labels: String) {
        var node: AccessibilityNodeInfo? = awaitText(*labels)
        while (node != null && !node.isClickable) node = node.parent
        assertNotNull(node)
        assertTrue(requireNotNull(node).performAction(AccessibilityNodeInfo.ACTION_CLICK))
    }

    fun clickPermissionButton(idSuffix: String) {
        var node: AccessibilityNodeInfo? = null
        awaitCondition("permission button was not visible") {
            node = allRoots().asSequence().flatMap(::walk).firstOrNull {
                it.viewIdResourceName?.endsWith(idSuffix) == true
            }
            node != null
        }
        assertTrue(requireNotNull(node).performAction(AccessibilityNodeInfo.ACTION_CLICK))
    }

    fun assertTouchTarget(label: String) {
        var node: AccessibilityNodeInfo? = awaitText(label)
        while (node != null && !node.isClickable) node = node.parent
        val bounds = Rect()
        requireNotNull(node).getBoundsInScreen(bounds)
        assertTrue("$label width was ${bounds.width()}px", bounds.width() >= dp(48))
        assertTrue("$label height was ${bounds.height()}px", bounds.height() >= dp(48))
    }

    fun awaitSystemSettings() = awaitCondition("Android settings should open") {
        automation.rootInActiveWindow?.packageName?.toString() == "com.android.settings"
    }

    fun pressBack() {
        assertTrue(automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK))
        SystemClock.sleep(250)
    }

    fun hasForegroundServiceNotification() =
        context.getSystemService(NotificationManager::class.java).activeNotifications.any {
            it.notification.category == Notification.CATEGORY_SERVICE
        }

    fun forceLandscape() {
        shell("settings put system accelerometer_rotation 0")
        shell("settings put system user_rotation 1")
        awaitCondition("landscape orientation") {
            screenBounds().width() > screenBounds().height()
        }
    }

    fun restoreRotation() { shell("settings put system accelerometer_rotation 1") }

    fun localizedContext(locale: Locale): Context =
        android.content.res.Configuration(context.resources.configuration).also { it.setLocale(locale) }
            .let(context::createConfigurationContext)

    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    fun awaitCondition(message: String, condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 12_000L
        var failure: Throwable? = null
        while (SystemClock.uptimeMillis() < deadline) {
            try { if (condition()) return } catch (caught: Throwable) { failure = caught }
            SystemClock.sleep(100)
        }
        throw AssertionError(message, failure)
    }

    private fun findNode(label: String) = allRoots().asSequence().flatMap(::walk).firstOrNull {
        it.text?.toString() == label || it.contentDescription?.toString() == label
    }

    private fun allRoots() = buildList {
        automation.rootInActiveWindow?.let(::add)
        automation.windows.mapNotNullTo(this) { it.root }
    }.distinctBy { it.windowId to it.hashCode() }

    private fun walk(root: AccessibilityNodeInfo): Sequence<AccessibilityNodeInfo> = sequence {
        yield(root)
        for (index in 0 until root.childCount) root.getChild(index)?.let { yieldAll(walk(it)) }
    }

    private fun targetWindows() = automation.windows.mapNotNull { window ->
        val root = window.root ?: return@mapNotNull null
        if (root.packageName?.toString() != context.packageName) return@mapNotNull null
        val bounds = Rect().also(window::getBoundsInScreen)
        WindowRecord(window.type, bounds)
    }

    private fun shell(command: String): String = automation.executeShellCommand(command).let {
        ParcelFileDescriptor.AutoCloseInputStream(it).bufferedReader().use { reader -> reader.readText() }
    }

    private data class WindowRecord(val type: Int, val bounds: Rect)
}
