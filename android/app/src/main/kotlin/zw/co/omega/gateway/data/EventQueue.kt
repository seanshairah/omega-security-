package zw.co.omega.gateway.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import zw.co.omega.gateway.model.GatewayEvent

/**
 * Durable outbox. Every call event is written here first and deleted only after the server
 * acknowledges it ("ok" or "duplicate"). Internet loss, process death and reboots lose nothing.
 */
class EventQueue(context: Context) : SQLiteOpenHelper(context.applicationContext, "gateway_queue.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT UNIQUE NOT NULL, json TEXT NOT NULL, createdAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT)")
        db.execSQL("CREATE INDEX outbox_created ON outbox(createdAt)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    @Synchronized
    fun enqueue(event: GatewayEvent) {
        val cv = ContentValues().apply {
            put("eventId", event.eventId)
            put("json", GatewayEvent.toStorageJson(event))
            put("createdAt", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("outbox", null, cv, SQLiteDatabase.CONFLICT_IGNORE)
    }

    data class Row(val id: Long, val event: GatewayEvent, val attempts: Int)

    @Synchronized
    fun peek(limit: Int = 100): List<Row> {
        val out = mutableListOf<Row>()
        readableDatabase.query("outbox", arrayOf("id", "json", "attempts"), null, null, null, null, "createdAt ASC, id ASC", limit.toString()).use { c ->
            while (c.moveToNext()) out += Row(c.getLong(0), GatewayEvent.fromJson(JSONObject(c.getString(1))), c.getInt(2))
        }
        return out
    }

    @Synchronized
    fun ack(eventIds: Collection<String>) {
        if (eventIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in eventIds) db.delete("outbox", "eventId = ?", arrayOf(id))
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    @Synchronized
    fun markAttempt(ids: Collection<Long>, error: String?) {
        if (ids.isEmpty()) return
        writableDatabase.execSQL("UPDATE outbox SET attempts = attempts + 1, lastError = ? WHERE id IN (${ids.joinToString(",")})", arrayOf(error ?: ""))
    }

    /** Permanently rejected by the server (malformed): drop so it cannot block the queue. */
    @Synchronized
    fun drop(eventId: String) {
        writableDatabase.delete("outbox", "eventId = ?", arrayOf(eventId))
    }

    @Synchronized
    fun size(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox", null).use { it.moveToFirst(); it.getInt(0) }
}
