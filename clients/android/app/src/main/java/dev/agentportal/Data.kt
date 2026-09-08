package dev.agentportal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.room.*
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.json.*

val json = Json { ignoreUnknownKeys = true }

fun JsonObject.str(key: String, default: String = "") =
    (get(key) as? JsonPrimitive)?.contentOrNull ?: default

fun JsonObject.num(key: String, default: Long = 0) =
    (get(key) as? JsonPrimitive)?.longOrNull ?: default

fun JsonObject.obj(key: String) = get(key) as? JsonObject ?: JsonObject(emptyMap())

fun JsonObject.arr(key: String) = get(key) as? JsonArray ?: JsonArray(emptyList())

fun parseObject(s: String) = json.parseToJsonElement(s).jsonObject

@Entity(primaryKeys = ["topic", "id"])
data class ItemRow(val topic: String, val id: String, val revision: Long, val payload: String?)

@Entity(primaryKeys = ["topic", "id"])
data class NotificationRow(
    val topic: String,
    val id: String,
    val revision: Long,
    val payload: String?,
)

@Entity data class SeenRow(@PrimaryKey val id: String, val topic: String)

@Entity data class CursorRow(@PrimaryKey val topic: String, val cursor: String)

@Entity(primaryKeys = ["topic", "item"])
data class PendingRow(val topic: String, val item: String, val event: String)

@Entity(primaryKeys = ["topic", "page"])
data class HistoryRow(val topic: String, val page: Int, val payload: String, val next: String?)

@Entity(primaryKeys = ["id", "version"])
data class TemplateRow(val id: String, val version: Long, val payload: String)

@Entity data class WidgetRow(@PrimaryKey val widgetId: Int, val topic: String, val item: String)

@Dao
interface PortalDao {
    @Query("SELECT * FROM NotificationRow WHERE topic=:topic AND id=:id")
    suspend fun notification(topic: String, id: String): NotificationRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putNotification(row: NotificationRow)

    @Query("DELETE FROM NotificationRow WHERE topic=:topic")
    suspend fun clearNotifications(topic: String)

    @Query("SELECT * FROM ItemRow ORDER BY topic,id") suspend fun items(): List<ItemRow>

    @Query("SELECT * FROM ItemRow WHERE topic=:topic AND id=:id")
    suspend fun item(topic: String, id: String): ItemRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putItem(row: ItemRow)

    @Query("DELETE FROM ItemRow WHERE topic=:topic") suspend fun clearItems(topic: String)

    @Query("SELECT * FROM CursorRow WHERE topic=:topic")
    suspend fun cursor(topic: String): CursorRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putCursor(row: CursorRow)

    @Query("DELETE FROM CursorRow WHERE topic=:topic") suspend fun clearCursor(topic: String)

    @Query("SELECT COUNT(*) FROM SeenRow WHERE id=:id") suspend fun seen(id: String): Int

    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun putSeen(row: SeenRow)

    @Query("DELETE FROM SeenRow WHERE topic=:topic") suspend fun clearSeen(topic: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putPending(row: PendingRow)

    @Query("SELECT * FROM PendingRow WHERE topic=:topic")
    suspend fun pending(topic: String): List<PendingRow>

    @Query("DELETE FROM PendingRow WHERE topic=:topic") suspend fun clearPending(topic: String)

    @Query("SELECT * FROM HistoryRow ORDER BY topic,page") suspend fun history(): List<HistoryRow>

    @Query("DELETE FROM HistoryRow WHERE topic=:topic") suspend fun clearHistory(topic: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putHistory(row: HistoryRow)

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putTemplate(row: TemplateRow)

    @Query("SELECT * FROM TemplateRow WHERE id=:id AND version=:version")
    suspend fun template(id: String, version: Long): TemplateRow?

    @Query("SELECT * FROM WidgetRow") suspend fun widgets(): List<WidgetRow>

    @Query("SELECT * FROM WidgetRow WHERE widgetId=:id") suspend fun widget(id: Int): WidgetRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putWidget(row: WidgetRow)

    @Query("DELETE FROM WidgetRow WHERE widgetId=:id") suspend fun deleteWidget(id: Int)
}

@Database(
    entities =
        [
            ItemRow::class,
            NotificationRow::class,
            SeenRow::class,
            CursorRow::class,
            PendingRow::class,
            HistoryRow::class,
            TemplateRow::class,
            WidgetRow::class,
        ],
    version = 2,
    exportSchema = false,
)
abstract class PortalDb : RoomDatabase() {
    abstract fun dao(): PortalDao

    companion object {
        val MIGRATION_1_2 =
            object : androidx.room.migration.Migration(1, 2) {
                override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                    db.execSQL(
                        "CREATE TABLE IF NOT EXISTS NotificationRow (topic TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT, PRIMARY KEY(topic,id))"
                    )
                    // Keep widget bindings and cached display items; rebase sync without replaying
                    // alerts.
                    db.execSQL("DELETE FROM CursorRow")
                    db.execSQL("DELETE FROM PendingRow")
                    db.execSQL("DELETE FROM SeenRow")
                    db.execSQL("DELETE FROM HistoryRow")
                }
            }
    }
}

class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("portal-settings", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("portal-token", null) as? SecretKey)
            ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                .apply {
                    init(
                        KeyGenParameterSpec.Builder(
                                "portal-token",
                                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                            )
                            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                            .build()
                    )
                }
                .generateKey()
    }

    var base: String
        get() = prefs.getString("base", "")!!
        set(v) {
            prefs.edit().putString("base", v).apply()
        }

    var topics: Set<String>
        get() = prefs.getStringSet("topics", emptySet())!!.toSet()
        set(v) {
            prefs.edit().putStringSet("topics", v).apply()
        }

    var notify: Boolean
        get() = prefs.getBoolean("notify", true)
        set(v) {
            prefs.edit().putBoolean("notify", v).apply()
        }

    var token: String
        get() {
            val text = prefs.getString("token", null) ?: return ""
            return try {
                val bytes = Base64.decode(text, Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    GCMParameterSpec(128, bytes.copyOfRange(0, 12)),
                )
                String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
            } catch (_: Exception) {
                ""
            }
        }
        set(value) {
            if (value.isEmpty()) {
                prefs.edit().remove("token").apply()
                return
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            prefs
                .edit()
                .putString(
                    "token",
                    Base64.encodeToString(
                        cipher.iv + cipher.doFinal(value.toByteArray()),
                        Base64.NO_WRAP,
                    ),
                )
                .apply()
        }
}

fun displayTime(value: String): String =
    runCatching {
            java.time.Instant.parse(value)
                .atZone(java.time.ZoneId.systemDefault())
                .format(java.time.format.DateTimeFormatter.ofPattern("MM月dd日 HH:mm"))
        }
        .getOrDefault(value)
