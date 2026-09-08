package dev.agentportal

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.*
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

object TemplateRenderer {
    private val known = setOf("layout.basic", "text.bind", "image.static", "progress.bind")

    fun valid(t: JsonObject): Boolean =
        runCatching {
                require(
                    t.keys.all {
                        it in
                            setOf(
                                "id",
                                "version",
                                "renderer_version",
                                "requires",
                                "asset_ids",
                                "widget",
                                "compact_widget",
                            )
                    }
                )
                require(t.num("renderer_version") == 1L && t.num("version") > 0)
                val expected = mutableSetOf("layout.basic")
                val assets = mutableSetOf<String>()
                for (tree in listOfNotNull(t["widget"], t["compact_widget"])) {
                    var count = 0
                    fun walk(v: JsonElement, depth: Int) {
                        val n = v.jsonObject
                        require(++count <= 32 && depth <= 4)
                        val allowed =
                            when (n.str("type")) {
                                "row",
                                "column" -> {
                                    val children = n.arr("children")
                                    require(children.size in 1..12)
                                    require(n.num("gap_dp", 4) in 0..24)
                                    children.forEach { walk(it, depth + 1) }
                                    setOf("type", "children", "gap_dp")
                                }
                                "text" -> {
                                    expected.add("text.bind")
                                    binding(n.obj("text"))
                                    require(
                                        n.str("style", "body") in setOf("title", "body", "caption")
                                    )
                                    require(n.num("max_lines", 2) in 1..4)
                                    setOf("type", "text", "style", "max_lines")
                                }
                                "progress" -> {
                                    expected.add("progress.bind")
                                    binding(n.obj("value"))
                                    setOf("type", "value")
                                }
                                "image" -> {
                                    expected.add("image.static")
                                    val id = n.str("asset_id")
                                    require(Regex("[a-f0-9]{64}").matches(id))
                                    assets.add(id)
                                    require(
                                        n.num("width_dp") in 8..256 && n.num("height_dp") in 8..256
                                    )
                                    require(n.str("fit", "contain") in setOf("contain", "cover"))
                                    setOf("type", "asset_id", "width_dp", "height_dp", "fit")
                                }
                                "spacer" -> {
                                    require(n.num("size_dp") in 0..32)
                                    setOf("type", "size_dp")
                                }
                                else -> error("Unknown node")
                            }
                        require(n.keys.all { it in allowed })
                    }
                    walk(tree, 1)
                }
                require(t["widget"] != null)
                val requires = t.arr("requires").map { it.jsonPrimitive.content }.toSet()
                require(known.containsAll(requires) && requires == expected)
                require(t.arr("asset_ids").map { it.jsonPrimitive.content }.toSet() == assets)
                true
            }
            .getOrDefault(false)

    private fun binding(v: JsonObject) {
        require(("bind" in v) xor ("value" in v))
        require(v.keys.all { it in setOf("bind", "value", "fallback") })
        if ("bind" in v) require(Regex("^(/([^~/]|~[01])*)+$").matches(v.str("bind")))
    }

    fun resolve(binding: JsonObject, content: JsonObject): JsonElement? {
        binding["value"]?.let {
            return it
        }
        var result: JsonElement = content
        for (segment in binding.str("bind").split('/').drop(1)) {
            val key = segment.replace("~1", "/").replace("~0", "~")
            result =
                when (result) {
                    is JsonObject -> result[key]
                    is JsonArray -> key.toIntOrNull()?.let { result.getOrNull(it) }
                    else -> null
                } ?: return binding["fallback"]
        }
        return if (result == JsonNull) binding["fallback"] else result
    }

    fun text(binding: JsonObject, content: JsonObject): String {
        val value = resolve(binding, content) as? JsonPrimitive
        return value?.contentOrNull ?: binding.str("fallback")
    }

    fun node(
        ctx: Context,
        repo: Repository,
        n: JsonObject,
        content: JsonObject,
        width: Float,
    ): RemoteViews {
        fun layout(id: Int) = RemoteViews(ctx.packageName, id)
        return when (n.str("type")) {
            "column",
            "row" -> {
                val row = n.str("type") == "row"
                val result = layout(if (row) R.layout.node_row else R.layout.node_column)
                val children = n.arr("children")
                val gap = n.num("gap_dp", 4).toFloat()
                val each =
                    if (row) ((width - gap * (children.size - 1)) / children.size).coerceAtLeast(8f)
                    else width
                children.forEachIndexed { i, e ->
                    if (i > 0) {
                        val spacer = layout(R.layout.node_spacer)
                        spacer.setViewLayoutWidth(
                            R.id.node,
                            if (row) gap else 1f,
                            TypedValue.COMPLEX_UNIT_DIP,
                        )
                        spacer.setViewLayoutHeight(
                            R.id.node,
                            if (row) 1f else gap,
                            TypedValue.COMPLEX_UNIT_DIP,
                        )
                        result.addView(R.id.node, spacer)
                    }
                    val child = node(ctx, repo, e.jsonObject, content, each)
                    if (row) {
                        val slot = layout(R.layout.node_slot)
                        slot.addView(R.id.node, child)
                        result.addView(R.id.node, slot)
                    } else result.addView(R.id.node, child)
                }
                result
            }
            "text" ->
                layout(R.layout.node_text).apply {
                    setTextViewText(R.id.node, text(n.obj("text"), content))
                    setTextViewTextSize(
                        R.id.node,
                        TypedValue.COMPLEX_UNIT_SP,
                        when (n.str("style", "body")) {
                            "title" -> 18f
                            "caption" -> 12f
                            else -> 14f
                        },
                    )
                    setInt(R.id.node, "setMaxLines", n.num("max_lines", 2).toInt())
                }
            "progress" ->
                layout(R.layout.node_progress).apply {
                    val b = n.obj("value")
                    val raw = resolve(b, content) as? JsonPrimitive
                    val value = if (raw?.isString == false) raw.doubleOrNull else null
                    val safe =
                        (value ?: b["fallback"]?.jsonPrimitive?.doubleOrNull ?: 0.0).coerceIn(
                            0.0,
                            1.0,
                        )
                    setProgressBar(R.id.node, 1000, (safe * 1000).toInt(), false)
                }
            "image" ->
                layout(
                        if (n.str("fit", "contain") == "cover") R.layout.node_image_cover
                        else R.layout.node_image
                    )
                    .apply {
                        val requested = n.num("width_dp").toFloat()
                        val w = requested.coerceAtMost(width)
                        setViewLayoutWidth(R.id.node, w, TypedValue.COMPLEX_UNIT_DIP)
                        setViewLayoutHeight(
                            R.id.node,
                            n.num("height_dp").toFloat() * w / requested,
                            TypedValue.COMPLEX_UNIT_DIP,
                        )
                        val file = repo.assetFile(n.str("asset_id"))
                        if (file.exists()) {
                            val bitmap = BitmapFactory.decodeFile(file.path)
                            if (bitmap != null) setImageViewBitmap(R.id.node, bitmap)
                        } else setImageViewResource(R.id.node, R.drawable.ic_portal)
                    }
            "spacer" ->
                layout(R.layout.node_spacer).apply {
                    setViewLayoutHeight(
                        R.id.node,
                        n.num("size_dp").toFloat(),
                        TypedValue.COMPLEX_UNIT_DIP,
                    )
                }
            else -> error("Unsupported component")
        }
    }
}

fun linkIntent(
    context: Context,
    content: JsonObject,
    topic: String,
    item: String,
    kind: String = "item",
): Intent {
    val target = content.obj("link").str("url")
    return if (target.startsWith("https://") || target.startsWith("http://"))
        Intent(Intent.ACTION_VIEW, Uri.parse(target)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    else
        Intent(context, MainActivity::class.java)
            .putExtra("topic", topic)
            .putExtra("item", item)
            .putExtra("kind", kind)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
}

class PortalWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        (context.applicationContext as PortalApp).scope.launch {
            try {
                for (id in ids) render(context, id)
            } finally {
                pending.finish()
            }
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        id: Int,
        options: Bundle,
    ) {
        onUpdate(context, manager, intArrayOf(id))
    }

    override fun onDeleted(context: Context, ids: IntArray) {
        val pending = goAsync()
        (context.applicationContext as PortalApp).scope.launch {
            try {
                for (id in ids) (context.applicationContext as PortalApp).repo.dao.deleteWidget(id)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        suspend fun refreshAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            for (id in
                manager.getAppWidgetIds(ComponentName(context, PortalWidget::class.java))) render(
                context,
                id,
            )
        }

        suspend fun render(context: Context, id: Int) {
            val repo = (context.applicationContext as PortalApp).repo
            val manager = AppWidgetManager.getInstance(context)
            val binding = repo.dao.widget(id)
            val row = binding?.let { repo.dao.item(it.topic, it.item) }
            val value = row?.payload?.let(::parseObject)
            val content = value?.obj("content")
            val rv = RemoteViews(context.packageName, R.layout.widget_root)
            if (content == null) {
                rv.setTextViewText(R.id.empty, if (binding == null) "选择要展示的内容" else "暂无当前内容")
                rv.setViewVisibility(R.id.empty, View.VISIBLE)
                rv.setTextViewText(R.id.updated, "Agent Portal")
                rv.setOnClickPendingIntent(
                    R.id.root,
                    PendingIntent.getActivity(
                        context,
                        id,
                        Intent(context, WidgetConfigActivity::class.java)
                            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            } else {
                rv.setViewVisibility(R.id.empty, View.GONE)
                val options = manager.getAppWidgetOptions(id)
                val width =
                    options
                        .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 240)
                        .coerceAtLeast(64)
                val height =
                    options
                        .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 120)
                        .coerceAtLeast(48)
                val ref = content["template"] as? JsonObject
                val template =
                    ref?.let { repo.dao.template(it.str("id"), it.num("version")) }
                        ?.let { runCatching { parseObject(it.payload) }.getOrNull() }
                val fallback =
                    parseObject(
                        """{"type":"column","children":[{"type":"text","text":{"bind":"/title"},"style":"title"},{"type":"text","text":{"bind":"/body"},"style":"body"}]}"""
                    )
                val tree =
                    if (
                        template != null &&
                            TemplateRenderer.valid(template) &&
                            width >= 100 &&
                            height >= 70
                    ) {
                        if (width < 180 || height < 110)
                            (template["compact_widget"] ?: template["widget"])!!.jsonObject
                        else template.obj("widget")
                    } else fallback
                val rendered =
                    runCatching {
                            TemplateRenderer.node(
                                context,
                                repo,
                                tree,
                                content,
                                (width - 28).toFloat(),
                            )
                        }
                        .getOrElse {
                            TemplateRenderer.node(
                                context,
                                repo,
                                fallback,
                                content,
                                (width - 28).toFloat(),
                            )
                        }
                rv.addView(R.id.content, rendered)
                rv.setTextViewText(R.id.updated, "更新于 " + displayTime(value.str("updated_at")))
                val intent = linkIntent(context, content, binding!!.topic, binding.item)
                intent.identifier = "widget:$id"
                rv.setOnClickPendingIntent(
                    R.id.root,
                    PendingIntent.getActivity(
                        context,
                        id,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            }
            manager.updateAppWidget(id, rv)
        }
    }
}
