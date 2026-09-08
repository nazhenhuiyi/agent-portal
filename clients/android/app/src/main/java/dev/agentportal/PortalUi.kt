package dev.agentportal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.JsonObject

@Composable
fun PortalTheme(content: @Composable () -> Unit) {
    val colors =
        if (isSystemInDarkTheme())
            darkColorScheme(
                primary = Color(0xFFC1CC99),
                onPrimary = Color(0xFF2C351E),
                outline = Color(0xFF858A78),
                background = Color(0xFF1C1D19),
                onBackground = Color(0xFFECEAE0),
                surface = Color(0xFF262720),
                onSurface = Color(0xFFECEAE0),
                onSurfaceVariant = Color(0xFFB9B9AC),
                surfaceVariant = Color(0xFF33352A),
                outlineVariant = Color(0xFF46483B),
                secondaryContainer = Color(0xFF3E472F),
                onSecondaryContainer = Color(0xFFDFE8C5),
            )
        else
            lightColorScheme(
                primary = Color(0xFF586645),
                onPrimary = Color.White,
                outline = Color(0xFF969B88),
                background = Color(0xFFF7F5EF),
                onBackground = Color(0xFF292D25),
                surface = Color(0xFFFFFFFF),
                onSurface = Color(0xFF292D25),
                onSurfaceVariant = Color(0xFF74776A),
                surfaceVariant = Color(0xFFEFEEE5),
                outlineVariant = Color(0xFFE1E2D6),
                secondaryContainer = Color(0xFFE5E9D8),
                onSecondaryContainer = Color(0xFF485735),
            )
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun PortalIcon(resource: Int, description: String? = null) {
    Icon(
        painterResource(resource),
        contentDescription = description,
        modifier = Modifier.size(22.dp),
    )
}

@Composable
fun SyncStatus(status: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(
            Modifier.size(6.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            shape = CircleShape,
        ) {}
        Text(
            status,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun SectionHeading(title: String, description: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(
            description,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun EmptyHistory(filtered: Boolean, onSettings: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        PortalIcon(R.drawable.ic_history)
        Text(if (filtered) "暂无相关记录" else "等待第一条消息", style = MaterialTheme.typography.titleMedium)
        Text(
            if (filtered) "切换到全部记录，查看其他内容。" else "连接服务并订阅主题后，消息会保存在这里。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!filtered) OutlinedButton(onClick = onSettings) { Text("连接服务") }
    }
}

@Composable
fun HistoryCard(event: JsonObject, topics: List<JsonObject>, onOpen: (JsonObject, String) -> Unit) {
    val notification = event.str("type").startsWith("notification.")
    val kind = if (notification) "notification" else "item"
    val removed = event.str("type").endsWith(".deleted") || event.str("type").endsWith(".cleared")
    val content = event.obj(kind).obj("content")
    val linked = !removed && content.obj("link").str("url").isNotEmpty()
    val topic =
        topics.firstOrNull { it.str("id") == event.str("topic_id") }?.str("name")
            ?: event.str("topic_id")
    var expanded by rememberSaveable(event.str("id")) { mutableStateOf(false) }
    var overflow by remember { mutableStateOf(false) }
    val ink = MaterialTheme.colorScheme.onSurface
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        modifier =
            Modifier.fillMaxWidth()
                .clickable(
                    enabled = linked,
                    onClickLabel = "打开详情",
                    onClick = { onOpen(content, kind) },
                ),
        shape = RoundedCornerShape(if (notification) 16.dp else 22.dp),
        color =
            if (notification) MaterialTheme.colorScheme.background
            else MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.7f)),
    ) {
        Column(
            Modifier.padding(if (notification) 16.dp else 22.dp),
            verticalArrangement = Arrangement.spacedBy(if (notification) 8.dp else 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    painterResource(
                        if (notification) R.drawable.ic_notification else R.drawable.ic_widget
                    ),
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    if (notification) "通知" else "展示",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "  /  $topic",
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelSmall,
                    color = muted,
                )
            }
            Text(
                if (removed) (if (notification) "已清除通知" else "已移除展示条目") else content.str("title"),
                style =
                    if (notification) MaterialTheme.typography.titleMedium
                    else MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Medium,
                color = ink,
                maxLines = if (expanded) Int.MAX_VALUE else 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (content.str("body").isNotEmpty())
                Text(
                    content.str("body"),
                    style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 23.sp),
                    color = muted,
                    maxLines = if (expanded) Int.MAX_VALUE else 3,
                    overflow = TextOverflow.Ellipsis,
                    onTextLayout = { if (!expanded) overflow = it.hasVisualOverflow },
                )
            if (!linked && (overflow || expanded))
                TextButton(
                    onClick = { expanded = !expanded },
                    contentPadding = PaddingValues(0.dp),
                ) {
                    Text(if (expanded) "收起" else "展开全文")
                }
            Row(
                Modifier.fillMaxWidth().padding(top = if (notification) 0.dp else 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    displayTime(event.str("recorded_at")),
                    style = MaterialTheme.typography.labelSmall,
                    color = muted,
                    modifier = Modifier.weight(1f),
                )
                if (linked) {
                    if (!notification)
                        Text(
                            "查看详情",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(end = 6.dp),
                        )
                    Icon(
                        painterResource(R.drawable.ic_arrow),
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
