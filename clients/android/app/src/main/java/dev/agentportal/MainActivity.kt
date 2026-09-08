package dev.agentportal

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun PortalTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            lightColorScheme(
                primary = Color(0xFF246B5E),
                background = Color(0xFFF8FAF7),
                surface = Color(0xFFF8FAF7),
                surfaceVariant = Color(0xFFEAF0E9),
                secondaryContainer = Color(0xFFD9E9DE),
                surfaceContainer = Color(0xFFEEF3EE),
            ),
        content = content,
    )
}

class MainActivity : ComponentActivity() {
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repo = (application as PortalApp).repo
        setContent {
            PortalTheme {
                val scope = rememberCoroutineScope()
                var tab by remember {
                    mutableIntStateOf(if (repo.settings.token.isEmpty()) 1 else 0)
                }
                val hasMore by repo.hasMoreHistory.collectAsState()
                val status by repo.status.collectAsState()
                val history by repo.history.collectAsState()
                val topics by repo.topics.collectAsState()
                var base by remember {
                    mutableStateOf(repo.settings.base.ifEmpty { "http://10.0.2.2:8080" })
                }
                var token by remember { mutableStateOf(repo.settings.token) }
                var selected by remember { mutableStateOf(repo.settings.topics) }
                var notifications by remember { mutableStateOf(repo.settings.notify) }
                var busy by remember { mutableStateOf(false) }
                var filter by remember { mutableStateOf(intent.getStringExtra("item")) }
                val filterKind = intent.getStringExtra("kind") ?: "item"
                val filterTopic = intent.getStringExtra("topic")
                LaunchedEffect(topics) { selected = repo.settings.topics }
                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            NavigationBarItem(
                                selected = tab == 0,
                                onClick = { tab = 0 },
                                icon = { Text("◷") },
                                label = { Text("历史") },
                            )
                            NavigationBarItem(
                                selected = tab == 1,
                                onClick = { tab = 1 },
                                icon = { Text("⚙") },
                                label = { Text("设置") },
                            )
                        }
                    }
                ) { padding ->
                    Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 20.dp)) {
                        Spacer(Modifier.height(20.dp))
                        Text(
                            "Agent Portal",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            status,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp, bottom = 18.dp),
                        )
                        if (tab == 0) {
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text("历史记录", style = MaterialTheme.typography.titleLarge)
                                TextButton(
                                    onClick = {
                                        scope.launch {
                                            try {
                                                repo.syncAll()
                                            } catch (_: Exception) {
                                                repo.status.value = "同步失败，已保留本地内容"
                                            }
                                        }
                                    }
                                ) {
                                    Text("刷新")
                                }
                            }
                            if (filter != null)
                                InputChip(
                                    selected = true,
                                    onClick = { filter = null },
                                    label = { Text("$filter · 查看全部") },
                                )
                            val visible =
                                history.filter {
                                    filter == null ||
                                        (it.str(filterKind + "_id") == filter &&
                                            (filterTopic == null ||
                                                it.str("topic_id") == filterTopic))
                                }
                            if (visible.isEmpty()) {
                                Spacer(Modifier.height(48.dp))
                                Text("还没有历史数据", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "连接服务并发布内容后，记录会出现在这里。",
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                            }
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(visible, key = { it.str("id") }) { event ->
                                    val kind =
                                        if (event.str("type").startsWith("notification."))
                                            "notification"
                                        else "item"
                                    val deleted =
                                        event.str("type").endsWith(".deleted") ||
                                            event.str("type").endsWith(".cleared")
                                    val content = event.obj(kind).obj("content")
                                    Card(
                                        Modifier.fillMaxWidth().clickable(
                                            enabled =
                                                !deleted &&
                                                    content.obj("link").str("url").isNotEmpty()
                                        ) {
                                            try {
                                                startActivity(
                                                    linkIntent(
                                                        this@MainActivity,
                                                        content,
                                                        event.str("topic_id"),
                                                        event.str(kind + "_id"),
                                                        kind,
                                                    )
                                                )
                                            } catch (_: Exception) {
                                                Toast.makeText(
                                                        this@MainActivity,
                                                        "无法发起跳转",
                                                        Toast.LENGTH_SHORT,
                                                    )
                                                    .show()
                                            }
                                        },
                                        colors =
                                            CardDefaults.cardColors(containerColor = Color.White),
                                    ) {
                                        Column(Modifier.padding(16.dp)) {
                                            Text(
                                                if (deleted)
                                                    (if (kind == "notification") "已清除通知"
                                                    else "已移除展示条目")
                                                else content.str("title"),
                                                style = MaterialTheme.typography.titleMedium,
                                            )
                                            if (content.str("body").isNotEmpty())
                                                Text(
                                                    content.str("body"),
                                                    modifier = Modifier.padding(top = 8.dp),
                                                    style = MaterialTheme.typography.bodyMedium,
                                                )
                                            Text(
                                                topics
                                                    .firstOrNull {
                                                        it.str("id") == event.str("topic_id")
                                                    }
                                                    ?.str("name") ?: event.str("topic_id"),
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.padding(top = 12.dp),
                                            )
                                            Text(
                                                displayTime(event.str("recorded_at")),
                                                style = MaterialTheme.typography.labelSmall,
                                            )
                                        }
                                    }
                                }
                                if (visible.isNotEmpty() && hasMore)
                                    item {
                                        TextButton(
                                            onClick = {
                                                scope.launch {
                                                    try {
                                                        repo.moreHistory()
                                                    } catch (_: Exception) {
                                                        repo.status.value = "暂时无法加载更多"
                                                    }
                                                }
                                            }
                                        ) {
                                            Text("加载更早记录")
                                        }
                                    }
                            }
                        } else {
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                item { Text("连接服务", style = MaterialTheme.typography.titleLarge) }
                                item {
                                    OutlinedTextField(
                                        base,
                                        { base = it },
                                        label = { Text("服务地址") },
                                        singleLine = true,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                                item {
                                    OutlinedTextField(
                                        token,
                                        { token = it },
                                        label = { Text("读取令牌") },
                                        singleLine = true,
                                        visualTransformation = PasswordVisualTransformation(),
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                                item {
                                    Button(
                                        enabled = !busy,
                                        onClick = {
                                            scope.launch {
                                                busy = true
                                                try {
                                                    repo.configure(base, token)
                                                    selected = repo.settings.topics
                                                    if (
                                                        notifications && Build.VERSION.SDK_INT >= 33
                                                    )
                                                        permission.launch(
                                                            Manifest.permission.POST_NOTIFICATIONS
                                                        )
                                                } catch (e: Exception) {
                                                    Toast.makeText(
                                                            this@MainActivity,
                                                            e.message ?: "连接失败",
                                                            Toast.LENGTH_SHORT,
                                                        )
                                                        .show()
                                                } finally {
                                                    busy = false
                                                }
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text(if (busy) "连接中…" else "保存并连接")
                                    }
                                }
                                item {
                                    Row(
                                        Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                    ) {
                                        Column {
                                            Text("允许内容提醒")
                                            Text(
                                                "系统通知权限仍由你控制",
                                                style = MaterialTheme.typography.bodySmall,
                                            )
                                        }
                                        Switch(
                                            notifications,
                                            {
                                                notifications = it
                                                repo.settings.notify = it
                                                if (it && Build.VERSION.SDK_INT >= 33)
                                                    permission.launch(
                                                        Manifest.permission.POST_NOTIFICATIONS
                                                    )
                                            },
                                        )
                                    }
                                }
                                if (topics.isNotEmpty()) {
                                    item {
                                        HorizontalDivider()
                                        Text(
                                            "订阅主题",
                                            style = MaterialTheme.typography.titleMedium,
                                            modifier = Modifier.padding(top = 14.dp),
                                        )
                                    }
                                    items(topics, key = { it.str("id") }) { topic ->
                                        val id = topic.str("id")
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Column {
                                                Text(topic.str("name"))
                                                Text(id, style = MaterialTheme.typography.bodySmall)
                                            }
                                            Checkbox(
                                                id in selected,
                                                { on ->
                                                    selected =
                                                        if (on) selected + id else selected - id
                                                },
                                            )
                                        }
                                    }
                                    item {
                                        OutlinedButton(
                                            onClick = {
                                                scope.launch { repo.selectTopics(selected) }
                                            }
                                        ) {
                                            Text("应用订阅")
                                        }
                                    }
                                }
                                item {
                                    Text(
                                        "小组件：在桌面长按空白处，添加 Agent Portal，然后选择要展示的条目。",
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                                item {
                                    Text(
                                        "本版在 App 打开时同步。离开后保留已有内容，后台及时接收将在后续版本提供。",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

class WidgetConfigActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val id =
            intent.getIntExtra(
                AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID,
            )
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        val repo = (application as PortalApp).repo
        setContent {
            PortalTheme {
                val items by repo.items.collectAsState()
                val scope = rememberCoroutineScope()
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(24.dp).padding(top = 32.dp)) {
                        Text("选择展示内容", style = MaterialTheme.typography.headlineSmall)
                        Text("一个小组件绑定一份持续更新的内容", modifier = Modifier.padding(vertical = 16.dp))
                        if (items.none { it.payload != null }) {
                            Text("暂无内容，请先连接服务并同步。")
                            Button(
                                onClick = {
                                    startActivity(
                                        Intent(this@WidgetConfigActivity, MainActivity::class.java)
                                    )
                                }
                            ) {
                                Text("打开 App")
                            }
                        }
                        LazyColumn {
                            items(
                                items.filter { it.payload != null },
                                key = { it.topic + "/" + it.id },
                            ) { row ->
                                val title = parseObject(row.payload!!).obj("content").str("title")
                                ListItem(
                                    headlineContent = { Text(title) },
                                    supportingContent = { Text(row.topic + " / " + row.id) },
                                    modifier =
                                        Modifier.clickable {
                                            scope.launch {
                                                repo.dao.putWidget(WidgetRow(id, row.topic, row.id))
                                                PortalWidget.render(this@WidgetConfigActivity, id)
                                                setResult(
                                                    RESULT_OK,
                                                    Intent()
                                                        .putExtra(
                                                            AppWidgetManager.EXTRA_APPWIDGET_ID,
                                                            id,
                                                        ),
                                                )
                                                finish()
                                            }
                                        },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
