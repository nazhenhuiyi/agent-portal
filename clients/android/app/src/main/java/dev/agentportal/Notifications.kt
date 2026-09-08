package dev.agentportal

import android.app.*
import android.content.Context
import androidx.core.app.NotificationCompat
import java.time.Instant
import kotlinx.serialization.json.*

object Notifications {
    private const val channel = "updates"

    private fun manager(c: Context) =
        c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun tag(topic: String, id: String) = "portal:n:$topic:$id"

    private fun legacyTag(tag: String?, topic: String) =
        tag?.split(':')?.let { it.size == 3 && it[0] == "portal" && it[1] == topic } == true

    fun clearTopic(c: Context, topic: String) {
        val m = manager(c)
        for (n in m.activeNotifications) if (
            n.tag?.startsWith("portal:n:$topic:") == true || legacyTag(n.tag, topic)
        )
            m.cancel(n.tag, n.id)
    }

    suspend fun reconcile(c: Context, repo: Repository, topic: String) {
        val m = manager(c)
        for (n in m.activeNotifications) {
            if (legacyTag(n.tag, topic)) {
                m.cancel(n.tag, n.id)
                continue
            }
            val prefix = "portal:n:$topic:"
            if (n.tag?.startsWith(prefix) == true) {
                val id = n.tag.removePrefix(prefix)
                val notification = repo.dao.notification(topic, id)?.payload?.let(::parseObject)
                if (notification == null) m.cancel(n.tag, n.id)
                else show(c, notification.obj("content"), topic, id, false)
            }
        }
    }

    suspend fun apply(c: Context, repo: Repository, event: JsonObject, offset: Long) {
        val topic = event.str("topic_id")
        val id = event.str("notification_id")
        val m = manager(c)
        if (event.str("type") == "notification.cleared") {
            m.cancel(tag(topic, id), 1)
            return
        }
        val notification = event.obj("notification")
        val expires =
            runCatching { Instant.parse(notification.str("expires_at")).toEpochMilli() }
                .getOrDefault(0)
        val alert =
            notification.str("mode") == "alert" &&
                expires > System.currentTimeMillis() + offset &&
                repo.settings.notify
        val exists = m.activeNotifications.any { it.tag == tag(topic, id) }
        if (alert || exists) show(c, notification.obj("content"), topic, id, alert)
    }

    private fun show(c: Context, content: JsonObject, topic: String, id: String, alert: Boolean) {
        val m = manager(c)
        m.createNotificationChannel(
            NotificationChannel(channel, "内容更新", NotificationManager.IMPORTANCE_DEFAULT)
        )
        if (!m.areNotificationsEnabled()) return
        val intent =
            linkIntent(c, content, topic, id, "notification").apply { identifier = tag(topic, id) }
        val pending =
            PendingIntent.getActivity(
                c,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val n =
            NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_portal)
                .setContentTitle(content.str("title"))
                .setContentText(content.str("body"))
                .setStyle(NotificationCompat.BigTextStyle().bigText(content.str("body")))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setSilent(!alert)
                .build()
        try {
            m.notify(tag(topic, id), 1, n)
        } catch (_: SecurityException) {
            /* Permission may change between check and notify. */
        }
    }
}
