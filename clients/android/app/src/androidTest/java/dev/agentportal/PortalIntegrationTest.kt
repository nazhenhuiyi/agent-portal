package dev.agentportal

import android.app.NotificationManager
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.widget.LinearLayout
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PortalIntegrationTest {
    private val instrument = InstrumentationRegistry.getInstrumentation()
    private val context = instrument.targetContext
    private val repo = (context.applicationContext as PortalApp).repo
    private val args = InstrumentationRegistry.getArguments()
    private val base
        get() = args.getString("base") ?: "http://10.0.2.2:8080"

    private val reader
        get() = args.getString("reader") ?: error("Pass reader token")

    private val writer
        get() = args.getString("writer") ?: error("Pass writer token")

    private fun send(
        path: String,
        method: String = "PUT",
        body: String? = null,
        token: String = writer,
    ): JsonObject? {
        val request =
            Request.Builder()
                .url(base + path)
                .header("Authorization", "Bearer $token")
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .method(method, body?.toRequestBody("application/json".toMediaType()))
                .build()
        OkHttpClient().newCall(request).execute().use { r ->
            assertTrue("HTTP ${r.code}", r.isSuccessful)
            return if (r.code == 204) null else parseObject(r.body!!.string())
        }
    }

    private fun publish(title: String, alert: Boolean = false): JsonObject {
        val content =
            parseObject(
                """{"title":"$title","body":"原生端到端验证","data":{"progress":0.6},"template":{"id":"report-card","version":1},"link":{"type":"url","url":"https://example.com"}}"""
            )
        val body = buildJsonObject {
            put(
                "item",
                buildJsonObject {
                    put("id", "integration-report")
                    put("content", content)
                },
            )
            if (alert)
                put(
                    "notification",
                    buildJsonObject {
                        put("id", "integration-report")
                        put(
                            "content",
                            buildJsonObject {
                                put("title", "任务完成提醒")
                                put("body", "点击查看")
                            },
                        )
                    },
                )
        }
        return send("/v1/topics/integration/publish", "POST", body.toString())!!.obj("item")
    }

    private suspend fun until(condition: suspend () -> Boolean) {
        withTimeout(20000) { while (!condition()) delay(150) }
    }

    @Test
    fun endToEnd() = runBlocking {
        val activity = ActivityScenario.launch(MainActivity::class.java)
        try {
            repo.foreground = false
            repo.stop()
            repo.configure(base, reader)
            publish("测试 · 生成中")
            repo.syncAll()
            val initial = repo.dao.item("integration", "integration-report")!!
            assertTrue(initial.payload!!.contains("生成中"))
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancelAll()
            // Render a real RemoteViews hierarchy on the UI thread.
            val host = AppWidgetHost(context, 404)
            val widgetId = host.allocateAppWidgetId()
            val manager = AppWidgetManager.getInstance(context)
            assertTrue(
                "App widget bind grant is required",
                manager.bindAppWidgetIdIfAllowed(
                    widgetId,
                    ComponentName(context, PortalWidget::class.java),
                ),
            )
            repo.dao.putWidget(WidgetRow(widgetId, "integration", "integration-report"))
            PortalWidget.render(context, widgetId)
            val template = repo.dao.template("report-card", 1)!!
            val content = parseObject(initial.payload).obj("content")
            val tree = parseObject(template.payload).obj("widget")
            instrument.runOnMainSync {
                val views = TemplateRenderer.node(context, repo, tree, content, 220f)
                val view = views.apply(context, LinearLayout(context))
                assertNotNull(view)
                assertTrue(view is android.view.ViewGroup)
            }
            // Enable foreground SSE and verify a real change arrives without manual refresh.
            repo.foreground = true
            repo.start()
            delay(600)
            val completed = publish("测试 · 已完成", true)
            until {
                repo.dao.item("integration", "integration-report")?.revision ==
                    completed.num("revision")
            }
            until {
                nm.activeNotifications.any { it.tag == "portal:n:integration:integration-report" }
            }
            assertTrue(
                repo.history.value.any { it.obj("item").obj("content").str("title") == "测试 · 已完成" }
            )
            // Clearing a system notification does not delete the item.
            nm.cancel("portal:n:integration:integration-report", 1)
            assertNotNull(repo.dao.item("integration", "integration-report")?.payload)
            repo.foreground = false
            repo.stop()
            delay(300)
            val before = repo.dao.item("integration", "integration-report")!!.revision
            publish("离线更新一")
            val offline = publish("离线更新二")
            delay(300)
            assertEquals(before, repo.dao.item("integration", "integration-report")!!.revision)
            repo.syncAll()
            assertEquals(
                offline.num("revision"),
                repo.dao.item("integration", "integration-report")!!.revision,
            )
            // Invalid epoch is returned as 410 and triggers an authoritative snapshot.
            val old = repo.dao.cursor("integration")!!.cursor
            val parts = old.split('.')
            assertEquals(2, parts.size)
            // Force expired history through the server harness is covered by server tests; local
            // recovery is exercised by an authenticated stale cursor supplied by the test runner if
            // present.
            args.getString("expiredCursor")?.let {
                repo.dao.putCursor(CursorRow("integration", it))
                repo.syncAll()
                assertNotEquals(it, repo.dao.cursor("integration")!!.cursor)
            }
            val unknown = parseObject(template.payload).toMutableMap()
            unknown["renderer_version"] = JsonPrimitive(999)
            assertFalse(TemplateRenderer.valid(JsonObject(unknown)))
            val intent = linkIntent(context, content, "integration", "integration-report")
            assertEquals("https://example.com", intent.data.toString())
            assertNotNull(intent.resolveActivity(context.packageManager))
            send("/v1/topics/integration/items/integration-report", "DELETE")
            repo.syncAll()
            assertNull(repo.dao.item("integration", "integration-report")?.payload)
            assertTrue(
                repo.history.value.any {
                    it.str("type") == "item.deleted" && it.str("item_id") == "integration-report"
                }
            )
            send("/v1/topics/integration/notifications/integration-report", "DELETE")
            repo.syncAll()
            assertFalse(
                nm.activeNotifications.any { it.tag == "portal:n:integration:integration-report" }
            )
            host.deleteAppWidgetId(widgetId)
            repo.dao.deleteWidget(widgetId)
        } finally {
            repo.foreground = false
            repo.stop()
            activity.close()
        }
    }

    @Test
    fun independentPresentation() = runBlocking {
        repo.foreground = false
        repo.stop()
        repo.configure(base, reader)
        repo.syncAll()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancelAll()
        val id = "notice-" + UUID.randomUUID().toString()
        val topic = "integration"
        val tag = "portal:n:$topic:$id"
        val np = "/v1/topics/$topic/notifications/$id"
        val ip = "/v1/topics/$topic/items/$id"
        val short =
            """{"content":{"title":"备份失败","body":"请查看日志","link":{"type":"url","url":"https://example.com/log"}}}"""
        send(np, body = short)
        repo.syncAll()
        assertNull(repo.dao.item(topic, id))
        assertFalse(repo.items.value.any { it.id == id })
        Notifications.reconcile(
            context,
            repo,
            "n",
        ) // A valid topic named n must not match other tags.
        val displayed = nm.activeNotifications.first { it.tag == tag }
        assertEquals(
            "备份失败",
            displayed.notification.extras.getString(android.app.Notification.EXTRA_TITLE),
        )
        assertTrue(repo.history.value.any { it.str("notification_id") == id })
        val nRevision = repo.dao.notification(topic, id)!!.revision
        send(
            ip,
            body =
                """{"content":{"title":"Agent 总览","body":"12 个任务，3 个运行中","data":{"progress":0.5},"link":{"type":"url","url":"https://example.com/overview"}}}""",
        )
        repo.syncAll()
        assertEquals(nRevision, repo.dao.notification(topic, id)!!.revision)
        assertEquals(
            "备份失败",
            nm.activeNotifications
                .first { it.tag == tag }
                .notification
                .extras
                .getString(android.app.Notification.EXTRA_TITLE),
        )
        assertEquals(
            "https://example.com/overview",
            linkIntent(
                    context,
                    parseObject(repo.dao.item(topic, id)!!.payload!!).obj("content"),
                    topic,
                    id,
                )
                .data
                .toString(),
        )
        assertEquals(
            "https://example.com/log",
            linkIntent(
                    context,
                    parseObject(repo.dao.notification(topic, id)!!.payload!!).obj("content"),
                    topic,
                    id,
                    "notification",
                )
                .data
                .toString(),
        )
        send(np, body = """{"content":{"title":"正在重试"},"mode":"silent"}""")
        repo.syncAll()
        assertEquals(
            "正在重试",
            nm.activeNotifications
                .first { it.tag == tag }
                .notification
                .extras
                .getString(android.app.Notification.EXTRA_TITLE),
        )
        assertEquals(1L, repo.dao.item(topic, id)!!.revision)
        send(np, "DELETE")
        repo.syncAll()
        assertFalse(nm.activeNotifications.any { it.tag == tag })
        assertNotNull(repo.dao.item(topic, id)!!.payload)
        send(np, body = short)
        send(ip, "DELETE")
        repo.syncAll()
        assertNull(repo.dao.item(topic, id)!!.payload)
        assertTrue(nm.activeNotifications.any { it.tag == tag })
        // Snapshot recovery reconciles existing notifications but never re-creates dismissed ones.
        nm.cancel(tag, 1)
        repo.dao.clearCursor(topic)
        repo.syncAll()
        assertFalse(nm.activeNotifications.any { it.tag == tag })
        // A silent update must not resurrect a dismissed notice.
        send(np, body = """{"content":{"title":"不打扰"},"mode":"silent"}""")
        repo.syncAll()
        assertFalse(nm.activeNotifications.any { it.tag == tag })
        send(np, body = """{"content":{"title":"已过时"},"ttl_seconds":0}""")
        repo.syncAll()
        assertFalse(nm.activeNotifications.any { it.tag == tag })
        // Multiple offline changes to the same notification resolve to the final state.
        send(np, body = short)
        send(np, "DELETE")
        repo.syncAll()
        assertFalse(nm.activeNotifications.any { it.tag == tag })
        val fallback =
            linkIntent(context, parseObject("""{"title":"无链接"}"""), topic, id, "notification")
        assertEquals("notification", fallback.getStringExtra("kind"))
        assertEquals(id, fallback.getStringExtra("item"))
    }

    @Test
    fun notificationsDisabled() = runBlocking {
        repo.foreground = false
        repo.stop()
        repo.configure(base, reader)
        repo.syncAll()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        assertFalse(nm.areNotificationsEnabled())
        val updated = publish("通知关闭时仍可同步", true)
        repo.syncAll()
        assertEquals(
            updated.num("revision"),
            repo.dao.item("integration", "integration-report")!!.revision,
        )
        assertTrue(nm.activeNotifications.isEmpty())
        val template = repo.dao.template("report-card", 1)!!
        val content = updated.obj("content")
        instrument.runOnMainSync {
            val rv =
                TemplateRenderer.node(
                    context,
                    repo,
                    parseObject(template.payload).obj("widget"),
                    content,
                    220f,
                )
            assertNotNull(rv.apply(context, LinearLayout(context)))
        }
    }

    @Test
    fun allTemplateNodes() {
        val asset = "a".repeat(64)
        val tree =
            parseObject(
                """{"type":"column","children":[{"type":"row","children":[{"type":"text","text":{"bind":"/data/count"}},{"type":"image","asset_id":"$asset","width_dp":32,"height_dp":32}]},{"type":"spacer","size_dp":8},{"type":"progress","value":{"bind":"/data/progress"}}]}"""
            )
        val content = parseObject("""{"title":"组件验证","data":{"count":12,"progress":2}}""")
        assertEquals(
            "12",
            TemplateRenderer.text(parseObject("""{"bind":"/data/count"}"""), content),
        )
        assertEquals(
            "缺省",
            TemplateRenderer.text(parseObject("""{"bind":"/missing","fallback":"缺省"}"""), content),
        )
        instrument.runOnMainSync {
            val rv = TemplateRenderer.node(context, repo, tree, content, 240f)
            val view = rv.apply(context, LinearLayout(context))
            view.measure(
                android.view.View.MeasureSpec.makeMeasureSpec(
                    720,
                    android.view.View.MeasureSpec.EXACTLY,
                ),
                android.view.View.MeasureSpec.makeMeasureSpec(
                    600,
                    android.view.View.MeasureSpec.AT_MOST,
                ),
            )
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)
            assertTrue(view.measuredHeight > 0)
        }
    }

    @Test
    fun widgetReapply() = runBlocking {
        // A launcher reuses the existing hierarchy: apply-only tests miss duplicate children.
        val host = AppWidgetHost(context, 405)
        val id = host.allocateAppWidgetId()
        val topic = "widget-ui-" + UUID.randomUUID()
        val manager = AppWidgetManager.getInstance(context)
        try {
            assertTrue(
                manager.bindAppWidgetIdIfAllowed(
                    id,
                    ComponentName(context, PortalWidget::class.java),
                )
            )
            manager.updateAppWidgetOptions(
                id,
                android.os.Bundle().apply {
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 280)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 100)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 240)
                },
            )
            repo.dao.putWidget(WidgetRow(id, topic, "report"))
            repo.dao.putItem(
                ItemRow(topic, "report", 1, """{"content":{"title":"生成中","body":"正在整理资料"}}""")
            )
            val first = PortalWidget.buildViews(context, id)
            lateinit var view: android.view.View
            instrument.runOnMainSync { view = first.apply(context, LinearLayout(context)) }
            repo.dao.putItem(
                ItemRow(topic, "report", 2, """{"content":{"title":"已完成","body":"查看完整报告"}}""")
            )
            repeat(5) {
                val update = PortalWidget.buildViews(context, id)
                instrument.runOnMainSync {
                    update.reapply(context, view)
                    val container = view.findViewById<LinearLayout>(R.id.content)
                    assertEquals(
                        "Each refresh must replace the previous tree",
                        1,
                        container.childCount,
                    )
                    fun texts(v: android.view.View): List<String> =
                        when (v) {
                            is android.widget.TextView -> listOf(v.text.toString())
                            is android.view.ViewGroup ->
                                (0 until v.childCount).flatMap { texts(v.getChildAt(it)) }
                            else -> emptyList()
                        }
                    assertEquals(
                        listOf("已完成", "查看完整报告"),
                        texts(container).filter { it.isNotEmpty() },
                    )
                }
            }
            manager.updateAppWidgetOptions(
                id,
                android.os.Bundle().apply {
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 100)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 100)
                },
            )
            val compact = PortalWidget.buildViews(context, id)
            instrument.runOnMainSync {
                compact.reapply(context, view)
                val container = view.findViewById<LinearLayout>(R.id.content)
                assertTrue(
                    "Small fallback uses a single title",
                    container.getChildAt(0) is android.widget.TextView,
                )
                assertEquals(1, (container.getChildAt(0) as android.widget.TextView).maxLines)
            }
            repo.dao.putItem(ItemRow(topic, "report", 3, null))
            val empty = PortalWidget.buildViews(context, id)
            instrument.runOnMainSync {
                empty.reapply(context, view)
                assertEquals(0, view.findViewById<LinearLayout>(R.id.content).childCount)
                assertEquals(
                    android.view.View.VISIBLE,
                    view.findViewById<android.view.View>(R.id.empty).visibility,
                )
            }
        } finally {
            host.deleteAppWidgetId(id)
            repo.dao.deleteWidget(id)
            repo.dao.clearItems(topic)
        }
    }

    @Test
    fun prepareDemo() = runBlocking {
        repo.foreground = false
        repo.stop()
        repo.configure(base, reader)
        repo.syncAll()
        assertTrue(repo.items.value.any { it.topic == "demo" && it.payload != null })
    }
}
