package dev.agentportal

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val repo = (application as PortalApp).repo
        setContent {
            PortalTheme {
                val scope = rememberCoroutineScope()
                var tab by rememberSaveable {
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
                var refreshing by remember { mutableStateOf(false) }
                var filter by remember { mutableStateOf(intent.getStringExtra("item")) }
                val filterKind = intent.getStringExtra("kind") ?: "item"
                val filterTopic = intent.getStringExtra("topic")
                LaunchedEffect(topics) { selected = repo.settings.topics }
                Scaffold(
                    bottomBar = {
                        NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                            NavigationBarItem(
                                selected = tab == 0,
                                onClick = { tab = 0 },
                                icon = { PortalIcon(R.drawable.ic_history) },
                                label = { Text("历史") },
                            )
                            NavigationBarItem(
                                selected = tab == 1,
                                onClick = { tab = 1 },
                                icon = { PortalIcon(R.drawable.ic_settings) },
                                label = { Text("设置") },
                            )
                        }
                    }
                ) { padding ->
                    Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 20.dp)) {
                        Row(
                            Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 20.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "AGENT PORTAL",
                                    style =
                                        MaterialTheme.typography.labelMedium.copy(
                                            letterSpacing = 2.sp
                                        ),
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                Text(
                                    if (tab == 0) "最近动态" else "设置",
                                    style = MaterialTheme.typography.headlineMedium,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(top = 6.dp),
                                )
                            }
                            if (tab == 0)
                                IconButton(
                                    enabled = !refreshing,
                                    onClick = {
                                        scope.launch {
                                            refreshing = true
                                            try {
                                                repo.syncAll()
                                            } catch (_: Exception) {
                                                repo.status.value = "同步失败，已保留本地内容"
                                            } finally {
                                                refreshing = false
                                            }
                                        }
                                    },
                                ) {
                                    if (refreshing)
                                        CircularProgressIndicator(
                                            Modifier.size(20.dp),
                                            strokeWidth = 2.dp,
                                        )
                                    else PortalIcon(R.drawable.ic_refresh, "刷新历史")
                                }
                        }
                        SyncStatus(status)
                        Spacer(Modifier.height(24.dp))
                        if (tab == 0) {
                            if (filter != null)
                                InputChip(
                                    selected = true,
                                    onClick = { filter = null },
                                    label = { Text("$filter · 查看全部") },
                                )
                            val visible =
                                history
                                    .sortedByDescending { it.str("recorded_at") }
                                    .filter {
                                        filter == null ||
                                            (it.str(filterKind + "_id") == filter &&
                                                (filterTopic == null ||
                                                    it.str("topic_id") == filterTopic))
                                    }
                            LazyColumn(
                                verticalArrangement = Arrangement.spacedBy(14.dp),
                                contentPadding = PaddingValues(bottom = 24.dp),
                            ) {
                                if (visible.isEmpty())
                                    item {
                                        EmptyHistory(
                                            filtered = filter != null,
                                            onSettings = { tab = 1 },
                                        )
                                    }
                                items(visible, key = { it.str("id") }) { event ->
                                    HistoryCard(event, topics) { content, kind ->
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
                            LazyColumn(
                                modifier = Modifier.imePadding(),
                                verticalArrangement = Arrangement.spacedBy(16.dp),
                                contentPadding = PaddingValues(bottom = 24.dp),
                            ) {
                                item { SectionHeading("连接服务", "填写你的服务地址与读取令牌") }
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
                                        Column(Modifier.weight(1f).padding(end = 16.dp)) {
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
                                    item { SectionHeading("订阅主题", "选择手机接收和展示的内容") }
                                    items(topics, key = { it.str("id") }) { topic ->
                                        val id = topic.str("id")
                                        Row(
                                            Modifier.fillMaxWidth(),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                        ) {
                                            Column(Modifier.weight(1f).padding(end = 12.dp)) {
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
                                                scope.launch {
                                                    try {
                                                        repo.selectTopics(selected)
                                                        Toast.makeText(
                                                                this@MainActivity,
                                                                "订阅已更新",
                                                                Toast.LENGTH_SHORT,
                                                            )
                                                            .show()
                                                    } catch (_: Exception) {
                                                        Toast.makeText(
                                                                this@MainActivity,
                                                                "订阅更新失败，请重试",
                                                                Toast.LENGTH_SHORT,
                                                            )
                                                            .show()
                                                    }
                                                }
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
        enableEdgeToEdge()
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
                    Column(
                        Modifier.fillMaxSize()
                            .windowInsetsPadding(WindowInsets.safeDrawing)
                            .padding(24.dp)
                    ) {
                        Text(
                            "桌面小组件",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            "选择展示内容",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(top = 8.dp),
                        )
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
                                    leadingContent = { PortalIcon(R.drawable.ic_widget) },
                                    trailingContent = { PortalIcon(R.drawable.ic_arrow) },
                                    headlineContent = {
                                        Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    },
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
