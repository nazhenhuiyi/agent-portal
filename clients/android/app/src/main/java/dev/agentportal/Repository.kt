package dev.agentportal

import android.app.NotificationManager
import android.content.Context
import androidx.room.withTransaction
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import okhttp3.*

class HttpFailure(val status: Int) : IOException("HTTP $status")

class Repository(val context: Context, val db: PortalDb) {
    val dao = db.dao()
    val settings = Settings(context)
    val status = MutableStateFlow("连接服务以开始")
    val items = MutableStateFlow<List<ItemRow>>(emptyList())
    val history = MutableStateFlow<List<JsonObject>>(emptyList())
    val hasMoreHistory = MutableStateFlow(false)
    val topics = MutableStateFlow<List<JsonObject>>(emptyList())
    val client =
        OkHttpClient.Builder()
            .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .build()
    private val scope = (context.applicationContext as PortalApp).scope
    private val mutex = Mutex()
    private var job: Job? = null
    private val streamCalls = ConcurrentHashMap.newKeySet<Call>()
    var foreground = false
    private var clockOffset = 0L

    init {
        scope.launch { refreshUi() }
    }

    private suspend fun execute(request: Request): Response = suspendCancellableCoroutine { c ->
        val call = client.newCall(request)
        c.invokeOnCancellation { call.cancel() }
        call.enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (c.isActive) c.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    if (c.isActive) c.resume(response) else response.close()
                }
            }
        )
    }

    private fun request(path: String) =
        Request.Builder()
            .url(settings.base.trimEnd('/') + path)
            .header("Authorization", "Bearer ${settings.token}")
            .build()

    suspend fun api(path: String): JsonObject =
        withContext(Dispatchers.IO) {
            execute(request(path)).use { r ->
                if (!r.isSuccessful) throw HttpFailure(r.code)
                val data = r.body?.string() ?: throw IOException("空响应")
                parseObject(data)
            }
        }

    suspend fun configure(base: String, token: String) {
        val u = java.net.URI(base.trim().trimEnd('/'))
        require(u.scheme == "https" || (BuildConfig.DEBUG && u.scheme == "http")) { "请使用 HTTPS 地址" }
        require(
            !u.host.isNullOrEmpty() && u.userInfo == null && u.query == null && u.fragment == null
        ) {
            "服务地址无效"
        }
        require(token.trim().isNotEmpty()) { "请填写读取令牌" }
        stop()
        job?.join()
        mutex.withLock {
            val changed = settings.base != u.toString() || settings.token != token.trim()
            if (changed) {
                withContext(Dispatchers.IO) {
                    db.clearAllTables()
                    File(context.filesDir, "assets").deleteRecursively()
                }
                (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                    .cancelAll()
                settings.topics = emptySet()
            }
            settings.base = u.toString()
            settings.token = token.trim()
            try {
                val list = api("/v1/topics").arr("topics").map { it.jsonObject }
                topics.value = list
                if (changed || settings.topics.isEmpty())
                    settings.topics = list.map { it.str("id") }.toSet()
                status.value = "已连接，选择需要展示的主题"
            } catch (e: Exception) {
                status.value = "连接失败：${message(e)}"
                throw e
            }
        }
        PortalWidget.refreshAll(context)
        refreshUi()
        if (foreground) start()
    }

    fun start() {
        if (job?.isActive == true || settings.base.isEmpty() || settings.token.isEmpty()) return
        job =
            scope.launch {
                try {
                    syncAll()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    status.value = message(e)
                }
                supervisorScope {
                    for (topic in settings.topics) launch(Dispatchers.IO) {
                        var delayMs = 1000L
                        while (isActive) {
                            try {
                                val call =
                                    client
                                        .newBuilder()
                                        .readTimeout(0, java.util.concurrent.TimeUnit.MILLISECONDS)
                                        .build()
                                        .newCall(request("/v1/topics/$topic/stream"))
                                streamCalls.add(call)
                                try {
                                    call.execute().use { r ->
                                        if (!r.isSuccessful) throw HttpFailure(r.code)
                                        val source = r.body!!.source()
                                        while (isActive && !source.exhausted()) {
                                            val line = source.readUtf8Line() ?: break
                                            if (line == "event: sync_required") {
                                                syncAll()
                                                delayMs = 1000
                                            }
                                        }
                                    }
                                } finally {
                                    streamCalls.remove(call)
                                    call.cancel()
                                }
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: HttpFailure) {
                                if (e.status == 401 || e.status == 403) {
                                    dropAccess(if (e.status == 401) null else topic)
                                    break
                                }
                                status.value = message(e)
                            } catch (_: Exception) {
                                if (isActive) status.value = "连接中断，将重试"
                            }
                            delay(delayMs)
                            delayMs = (delayMs * 2).coerceAtMost(30000)
                        }
                    }
                    launch {
                        while (isActive) {
                            delay(60000)
                            try {
                                syncAll()
                            } catch (e: CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                status.value = message(e)
                            }
                        }
                    }
                }
            }
    }

    fun stop() {
        job?.cancel()
        streamCalls.forEach { it.cancel() }
        streamCalls.clear()
    }

    suspend fun selectTopics(selected: Set<String>) {
        stop()
        job?.join()
        mutex.withLock {
            for (old in settings.topics - selected) clearTopic(old)
            settings.topics = selected
        }
        PortalWidget.refreshAll(context)
        refreshUi()
        if (foreground) start()
    }

    private fun message(e: Exception) =
        when (e) {
            is HttpFailure ->
                if (e.status == 401 || e.status == 403) "访问权限已失效，请重新配置" else "服务返回 ${e.status}"
            else -> "暂时无法连接，已保留本地内容"
        }

    private suspend fun clearTopic(t: String) {
        db.withTransaction {
            dao.clearItems(t)
            dao.clearNotifications(t)
            dao.clearCursor(t)
            dao.clearSeen(t)
            dao.clearPending(t)
            dao.clearHistory(t)
        }
        Notifications.clearTopic(context, t)
    }

    private suspend fun dropAccess(t: String?) {
        mutex.withLock {
            if (t == null) {
                for (topic in settings.topics) clearTopic(topic)
                settings.token = ""
                settings.topics = emptySet()
            } else {
                clearTopic(t)
                settings.topics = settings.topics - t
            }
        }
        PortalWidget.refreshAll(context)
        refreshUi()
        status.value = "访问权限已失效，请重新配置"
    }

    suspend fun syncAll() {
        if (settings.token.isEmpty()) return
        mutex.withLock {
            status.value = "正在同步…"
            val available =
                try {
                    api("/v1/topics").arr("topics").map { it.jsonObject }
                } catch (e: HttpFailure) {
                    if (e.status == 401 || e.status == 403) {
                        for (t in settings.topics) clearTopic(t)
                        settings.token = ""
                        settings.topics = emptySet()
                        PortalWidget.refreshAll(context)
                        refreshUi()
                    }
                    throw e
                }
            topics.value = available
            for (t in settings.topics - available.map { it.str("id") }.toSet()) {
                clearTopic(t)
                settings.topics = settings.topics - t
            }
            for (t in settings.topics) {
                try {
                    syncTopic(t)
                    refreshHistory(t)
                } catch (e: HttpFailure) {
                    if (e.status == 401 || e.status == 403) {
                        clearTopic(t)
                        settings.topics = settings.topics - t
                    } else throw e
                }
            }
            refreshUi()
            status.value = "已同步 · ${java.time.LocalTime.now().withNano(0)}"
        }
    }

    private suspend fun syncTopic(t: String) {
        var cursor = dao.cursor(t)?.cursor
        do {
            val endpoint =
                "/v1/topics/$t/sync" +
                    (cursor?.let {
                        "?cursor=" + java.net.URLEncoder.encode(it, "UTF-8") + "&limit=100"
                    } ?: "")
            val result =
                try {
                    api(endpoint)
                } catch (e: HttpFailure) {
                    if (e.status == 410) {
                        cursor = null
                        api("/v1/topics/$t/sync")
                    } else throw e
                }
            clockOffset =
                runCatching {
                        Instant.parse(result.str("server_time")).toEpochMilli() -
                            System.currentTimeMillis()
                    }
                    .getOrDefault(0)
            val snapshot = result.str("mode") == "snapshot"
            db.withTransaction {
                if (snapshot) {
                    dao.clearItems(t)
                    dao.clearNotifications(t)
                    dao.clearPending(t)
                    dao.clearSeen(t)
                    for (v in result.arr("notifications")) {
                        val n = v.jsonObject
                        dao.putNotification(
                            NotificationRow(t, n.str("id"), n.num("revision"), n.toString())
                        )
                    }
                    for (v in result.arr("items")) {
                        val item = v.jsonObject
                        dao.putItem(
                            ItemRow(t, item.str("id"), item.num("revision"), item.toString())
                        )
                    }
                } else
                    for (v in result.arr("events")) {
                        val e = v.jsonObject
                        if (dao.seen(e.str("id")) > 0) continue
                        dao.putSeen(SeenRow(e.str("id"), t))
                        if (e.str("type").startsWith("notification.")) {
                            val id = e.str("notification_id")
                            val old = dao.notification(t, id)
                            if (old == null || e.num("revision") > old.revision) {
                                val payload =
                                    e["notification"].takeIf { it != JsonNull }?.toString()
                                dao.putNotification(
                                    NotificationRow(t, id, e.num("revision"), payload)
                                )
                                dao.putPending(PendingRow(t, id, e.toString()))
                            }
                        } else if (e.str("type").startsWith("item.")) {
                            val old = dao.item(t, e.str("item_id"))
                            if (old == null || e.num("revision") > old.revision) {
                                val payload = e["item"].takeIf { it != JsonNull }?.toString()
                                dao.putItem(
                                    ItemRow(t, e.str("item_id"), e.num("revision"), payload)
                                )
                            }
                        }
                    }
                cursor = result.str("next_cursor")
                dao.putCursor(CursorRow(t, cursor!!))
            }
            if (snapshot) Notifications.reconcile(context, this, t)
            currentCoroutineContext().ensureActive()
        } while (snapshot || result["has_more"]?.jsonPrimitive?.booleanOrNull == true)
        for (p in dao.pending(t)) Notifications.apply(
            context,
            this,
            parseObject(p.event),
            clockOffset,
        )
        dao.clearPending(t)
        cacheTemplates(t)
        PortalWidget.refreshAll(context)
    }

    private suspend fun cacheTemplates(t: String) {
        for (row in dao.items().filter { it.topic == t && it.payload != null }) {
            val ref =
                parseObject(row.payload!!).obj("content")["template"] as? JsonObject ?: continue
            try {
                var template =
                    dao.template(ref.str("id"), ref.num("version"))?.let { parseObject(it.payload) }
                if (template == null) {
                    template = api("/v1/templates/${ref.str("id")}/versions/${ref.num("version")}")
                    if (TemplateRenderer.valid(template))
                        dao.putTemplate(
                            TemplateRow(ref.str("id"), ref.num("version"), template.toString())
                        )
                }
                if (TemplateRenderer.valid(template)) {
                    for (a in template.arr("asset_ids")) {
                        val id = a.jsonPrimitive.content
                        val file = assetFile(id)
                        if (!file.exists())
                            withContext(Dispatchers.IO) {
                                execute(request("/v1/assets/$id")).use { r ->
                                    if (!r.isSuccessful) throw HttpFailure(r.code)
                                    val bytes = r.body!!.bytes()
                                    require(bytes.size <= 2097152)
                                    require(
                                        MessageDigest.getInstance("SHA-256")
                                            .digest(bytes)
                                            .joinToString("") { "%02x".format(it) } == id
                                    )
                                    file.parentFile!!.mkdirs()
                                    file.writeBytes(bytes)
                                }
                            }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: HttpFailure) {
                if (e.status == 401 || e.status == 403) throw e
            } catch (_: Exception) {
                /* Built-in card remains available. */
            }
        }
    }

    fun assetFile(id: String): File {
        require(Regex("[a-f0-9]{64}").matches(id))
        return File(context.filesDir, "assets/$id")
    }

    private suspend fun refreshHistory(t: String) {
        val result = api("/v1/topics/$t/history?limit=50")
        db.withTransaction {
            dao.clearHistory(t)
            dao.putHistory(
                HistoryRow(
                    t,
                    0,
                    result.arr("events").toString(),
                    result["next_before"]?.jsonPrimitive?.contentOrNull,
                )
            )
        }
    }

    suspend fun moreHistory() {
        mutex.withLock {
            for (t in settings.topics) {
                val page =
                    dao.history().filter { it.topic == t }.maxByOrNull { it.page } ?: continue
                val next = page.next ?: continue
                val result =
                    api(
                        "/v1/topics/$t/history?limit=50&before=" +
                            java.net.URLEncoder.encode(next, "UTF-8")
                    )
                dao.putHistory(
                    HistoryRow(
                        t,
                        page.page + 1,
                        result.arr("events").toString(),
                        result["next_before"]?.jsonPrimitive?.contentOrNull,
                    )
                )
            }
            refreshUi()
        }
    }

    suspend fun refreshUi() {
        items.value = dao.items()
        val pages = dao.history()
        hasMoreHistory.value =
            pages.groupBy { it.topic }.values.any { it.maxByOrNull { p -> p.page }?.next != null }
        history.value =
            pages
                .flatMap { json.parseToJsonElement(it.payload).jsonArray.map { v -> v.jsonObject } }
                .distinctBy { it.str("id") }
    }
}
