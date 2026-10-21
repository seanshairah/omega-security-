package zw.co.omega.gateway.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import zw.co.omega.gateway.model.GatewayEvent
import zw.co.omega.gateway.service.OutboxStatus
import zw.co.omega.gateway.service.Priority
import zw.co.omega.gateway.service.SyncPlanner

/**
 * Durable outbox plus the sync log. Every event (calls, location, later emergencies) is written
 * here first and deleted only after the server acknowledges it ("ok" or "duplicate"). Internet
 * loss, process death and reboots lose nothing.
 *
 * Schema v2 adds per-row status, priority, retry time and timestamps, and a `sync_log` table the
 * diagnostics screen and the server read. v1 rows become QUEUED / NORMAL on upgrade.
 *
 * One instance per process ([get]). Each instance of a SQLiteOpenHelper keeps its own connection,
 * and `@Synchronized` locks only that instance, so ten helpers on one file meant unserialised
 * writers ("database is locked") and connections nobody closed. Write-ahead logging lets the
 * screens read while the sync engine writes. Neither changes the schema: queued rows survive.
 */
class EventQueue private constructor(context: Context) : SQLiteOpenHelper(context.applicationContext, "gateway_queue.db", null, 3) {
    init { setWriteAheadLoggingEnabled(true) }

    companion object {
        @Volatile private var instance: EventQueue? = null

        /** The process-wide queue. Safe from any thread; never closed while the process lives. */
        fun get(context: Context): EventQueue = instance ?: synchronized(this) { instance ?: EventQueue(context.applicationContext).also { instance = it } }
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT UNIQUE NOT NULL, json TEXT NOT NULL, createdAt INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT)")
        db.execSQL("CREATE INDEX outbox_created ON outbox(createdAt)")
        upgradeTo2(db)
        upgradeTo3(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) upgradeTo2(db)
        if (oldVersion < 3) upgradeTo3(db)
    }

    /** v3: the communication log the guard sees (alerts, status messages, calls) with delivery and acknowledgement state. */
    private fun upgradeTo3(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE IF NOT EXISTS comm_log (id INTEGER PRIMARY KEY AUTOINCREMENT, eventId TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, type TEXT NOT NULL, summary TEXT, at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED', hasLocation INTEGER NOT NULL DEFAULT 0, sentAt INTEGER, ackBy TEXT, ackAt INTEGER, ackNote TEXT, resolvedAt INTEGER)")
        db.execSQL("CREATE INDEX IF NOT EXISTS comm_log_at ON comm_log(at)")
    }

    private fun upgradeTo2(db: SQLiteDatabase) {
        db.execSQL("ALTER TABLE outbox ADD COLUMN status TEXT NOT NULL DEFAULT 'QUEUED'")
        db.execSQL("ALTER TABLE outbox ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE outbox ADD COLUMN eventType TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE outbox ADD COLUMN nextAttemptAt INTEGER NOT NULL DEFAULT 0")
        db.execSQL("ALTER TABLE outbox ADD COLUMN sendingSince INTEGER")
        db.execSQL("ALTER TABLE outbox ADD COLUMN lastAttemptAt INTEGER")
        db.execSQL("CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status, priority, nextAttemptAt)")
        db.execSQL("CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, trigger TEXT NOT NULL, online INTEGER NOT NULL, sent INTEGER NOT NULL, acked INTEGER NOT NULL, duplicates INTEGER NOT NULL, rejected INTEGER NOT NULL, retried INTEGER NOT NULL, error TEXT, durationMs INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX IF NOT EXISTS sync_log_at ON sync_log(at)")
    }

    // ---------------- outbox ----------------

    @Synchronized
    fun enqueue(event: GatewayEvent, priority: Int = Priority.forEventType(event.eventType)): Boolean {
        val cv = ContentValues().apply {
            put("eventId", event.eventId)
            put("json", GatewayEvent.toStorageJson(event))
            put("createdAt", System.currentTimeMillis())
            put("status", OutboxStatus.QUEUED.name)
            put("priority", priority)
            put("eventType", event.eventType)
            put("nextAttemptAt", 0L)
        }
        return writableDatabase.insertWithOnConflict("outbox", null, cv, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    data class Row(val id: Long, val event: GatewayEvent, val attempts: Int, val priority: Int, val status: OutboxStatus, val createdAt: Long)

    /** Rows due now, highest priority first, oldest first within a priority. Stale SENDING rows (a run that died) are included. */
    @Synchronized
    fun due(now: Long = System.currentTimeMillis(), limit: Int = 100): List<Row> {
        val out = mutableListOf<Row>()
        readableDatabase.query("outbox", arrayOf("id", "json", "attempts", "priority", "status", "createdAt", "nextAttemptAt", "sendingSince"), "status != ?", arrayOf(OutboxStatus.FAILED.name), null, null, "priority DESC, createdAt ASC, id ASC").use { c ->
            while (c.moveToNext() && out.size < limit) {
                val status = runCatching { OutboxStatus.valueOf(c.getString(4)) }.getOrDefault(OutboxStatus.QUEUED)
                if (!SyncPlanner.isDue(status, c.getLong(6), now, if (c.isNull(7)) null else c.getLong(7))) continue
                out += Row(c.getLong(0), GatewayEvent.fromJson(JSONObject(c.getString(1))), c.getInt(2), c.getInt(3), status, c.getLong(5))
            }
        }
        return out
    }

    /** Backwards-compatible: everything not FAILED, in send order. */
    @Synchronized
    fun peek(limit: Int = 100): List<Row> = due(Long.MAX_VALUE / 2, limit)

    @Synchronized
    fun markSending(ids: Collection<Long>, now: Long = System.currentTimeMillis()) {
        if (ids.isEmpty()) return
        writableDatabase.execSQL("UPDATE outbox SET status = 'SENDING', sendingSince = ?, lastAttemptAt = ?, attempts = attempts + 1 WHERE id IN (${ids.joinToString(",")})", arrayOf(now, now))
    }

    /** Acknowledged by the server: the row's job is done. */
    @Synchronized
    fun ack(eventIds: Collection<String>) {
        if (eventIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try { for (id in eventIds) db.delete("outbox", "eventId = ?", arrayOf(id)); db.setTransactionSuccessful() } finally { db.endTransaction() }
    }

    /** Transport failure or no ack: back off per row according to its attempts and priority. */
    @Synchronized
    fun markRetry(rows: Collection<Row>, error: String?, now: Long = System.currentTimeMillis()) {
        if (rows.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (r in rows) {
                val attempts = r.attempts + 1
                if (SyncPlanner.shouldFail(attempts)) db.execSQL("UPDATE outbox SET status = 'FAILED', sendingSince = NULL, lastError = ? WHERE id = ?", arrayOf(error ?: "gave up", r.id))
                else db.execSQL("UPDATE outbox SET status = 'RETRY_PENDING', sendingSince = NULL, nextAttemptAt = ?, lastError = ? WHERE id = ?", arrayOf(SyncPlanner.nextAttemptAt(now, attempts, r.priority), error ?: "", r.id))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    /** Kept for older callers: bump attempts and store the error without changing status. */
    @Synchronized
    fun markAttempt(ids: Collection<Long>, error: String?) {
        if (ids.isEmpty()) return
        writableDatabase.execSQL("UPDATE outbox SET attempts = attempts + 1, lastError = ?, status = 'RETRY_PENDING', sendingSince = NULL WHERE id IN (${ids.joinToString(",")})", arrayOf(error ?: ""))
    }

    /** Permanently rejected by the server (malformed): kept as FAILED for diagnostics, never sent again. */
    @Synchronized
    fun fail(eventId: String, error: String?) {
        writableDatabase.execSQL("UPDATE outbox SET status = 'FAILED', sendingSince = NULL, lastError = ? WHERE eventId = ?", arrayOf(error ?: "rejected", eventId))
    }

    /** Alias kept for existing callers. */
    fun drop(eventId: String) = fail(eventId, "rejected")

    /** Crash recovery at service start: nothing can still be "sending". */
    @Synchronized
    fun resetSending() { writableDatabase.execSQL("UPDATE outbox SET status = 'QUEUED', sendingSince = NULL WHERE status = 'SENDING'") }

    @Synchronized
    fun size(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM outbox WHERE status != 'FAILED'", null).use { it.moveToFirst(); it.getInt(0) }

    data class Counts(val queued: Int, val sending: Int, val retryPending: Int, val failed: Int) { val pending get() = queued + sending + retryPending }

    @Synchronized
    fun counts(): Counts {
        var q = 0; var s = 0; var r = 0; var f = 0
        readableDatabase.rawQuery("SELECT status, COUNT(*) FROM outbox GROUP BY status", null).use { c ->
            while (c.moveToNext()) when (c.getString(0)) { "QUEUED" -> q = c.getInt(1); "SENDING" -> s = c.getInt(1); "RETRY_PENDING" -> r = c.getInt(1); "FAILED" -> f = c.getInt(1) }
        }
        return Counts(q, s, r, f)
    }

    /** Earliest retry time among waiting rows, for the coordinator's timer. */
    @Synchronized
    fun nextAttemptAt(): Long? = readableDatabase.rawQuery("SELECT MIN(nextAttemptAt) FROM outbox WHERE status IN ('QUEUED','RETRY_PENDING')", null).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else null }

    /** Oldest pending row's age in ms (how far behind the phone is), or null when nothing waits. */
    @Synchronized
    fun oldestPendingMs(now: Long = System.currentTimeMillis()): Long? = readableDatabase.rawQuery("SELECT MIN(createdAt) FROM outbox WHERE status != 'FAILED'", null).use { if (it.moveToFirst() && !it.isNull(0)) now - it.getLong(0) else null }

    /** Forget FAILED rows older than a week so the table cannot grow forever. */
    @Synchronized
    fun purgeFailed(olderThanMs: Long = 7 * 24 * 3600_000L, now: Long = System.currentTimeMillis()) {
        writableDatabase.execSQL("DELETE FROM outbox WHERE status = 'FAILED' AND createdAt < ?", arrayOf(now - olderThanMs))
    }

    // ---------------- sync log ----------------

    data class LogRow(val at: Long, val trigger: String, val online: Boolean, val sent: Int, val acked: Int, val duplicates: Int, val rejected: Int, val retried: Int, val error: String?, val durationMs: Long)

    @Synchronized
    fun log(r: LogRow) {
        writableDatabase.insert("sync_log", null, ContentValues().apply {
            put("at", r.at); put("trigger", r.trigger); put("online", if (r.online) 1 else 0); put("sent", r.sent); put("acked", r.acked); put("duplicates", r.duplicates); put("rejected", r.rejected); put("retried", r.retried); put("error", r.error); put("durationMs", r.durationMs)
        })
        writableDatabase.execSQL("DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY at DESC LIMIT 200)")
    }

    @Synchronized
    fun recentLog(limit: Int = 20): List<LogRow> {
        val out = mutableListOf<LogRow>()
        readableDatabase.query("sync_log", arrayOf("at", "trigger", "online", "sent", "acked", "duplicates", "rejected", "retried", "error", "durationMs"), null, null, null, null, "at DESC", limit.toString()).use { c ->
            while (c.moveToNext()) out += LogRow(c.getLong(0), c.getString(1), c.getInt(2) == 1, c.getInt(3), c.getInt(4), c.getInt(5), c.getInt(6), c.getInt(7), if (c.isNull(8)) null else c.getString(8), c.getLong(9))
        }
        return out
    }

    // ---------------- communication log ----------------

    /** QUEUED → SENT (server acknowledged receipt) → ACKNOWLEDGED (operations saw it) → RESOLVED; FAILED when rejected. */
    data class CommRow(val eventId: String, val kind: String, val type: String, val summary: String?, val at: Long, val status: String, val hasLocation: Boolean, val sentAt: Long?, val ackBy: String?, val ackAt: Long?, val ackNote: String?, val resolvedAt: Long?)

    @Synchronized
    fun logComm(eventId: String, kind: String, type: String, summary: String?, at: Long, hasLocation: Boolean) {
        writableDatabase.insertWithOnConflict("comm_log", null, ContentValues().apply { put("eventId", eventId); put("kind", kind); put("type", type); put("summary", summary); put("at", at); put("status", "QUEUED"); put("hasLocation", if (hasLocation) 1 else 0) }, SQLiteDatabase.CONFLICT_IGNORE)
        writableDatabase.execSQL("DELETE FROM comm_log WHERE id NOT IN (SELECT id FROM comm_log ORDER BY at DESC LIMIT 300)")
    }

    /** The server acknowledged receipt of these events. Rows already further along (acknowledged) are left alone. */
    @Synchronized
    fun markCommSent(eventIds: Collection<String>, now: Long = System.currentTimeMillis()) {
        if (eventIds.isEmpty()) return
        val db = writableDatabase
        db.beginTransaction()
        try { for (id in eventIds) db.execSQL("UPDATE comm_log SET status = 'SENT', sentAt = ? WHERE eventId = ? AND status = 'QUEUED'", arrayOf(now, id)); db.setTransactionSuccessful() } finally { db.endTransaction() }
    }

    @Synchronized
    fun markCommFailed(eventId: String, error: String?) { writableDatabase.execSQL("UPDATE comm_log SET status = 'FAILED', ackNote = ? WHERE eventId = ?", arrayOf(error ?: "rejected", eventId)) }

    /** Operations' acknowledgement / resolution as reported by the server on a heartbeat. */
    @Synchronized
    fun applyServerAlertState(eventId: String, status: String, ackBy: String?, ackAt: Long?, ackNote: String?, resolvedAt: Long?) {
        val st = when (status) { "ACKNOWLEDGED" -> "ACKNOWLEDGED"; "RESOLVED" -> "RESOLVED"; else -> "SENT" }
        writableDatabase.execSQL("UPDATE comm_log SET status = CASE WHEN status IN ('QUEUED','SENT','ACKNOWLEDGED') THEN ? ELSE status END, ackBy = COALESCE(?, ackBy), ackAt = COALESCE(?, ackAt), ackNote = COALESCE(?, ackNote), resolvedAt = COALESCE(?, resolvedAt), sentAt = COALESCE(sentAt, ?) WHERE eventId = ?", arrayOf(st, ackBy, ackAt, ackNote, resolvedAt, System.currentTimeMillis(), eventId))
    }

    @Synchronized
    fun recentComm(limit: Int = 20, kind: String? = null): List<CommRow> {
        val out = mutableListOf<CommRow>()
        readableDatabase.query("comm_log", arrayOf("eventId", "kind", "type", "summary", "at", "status", "hasLocation", "sentAt", "ackBy", "ackAt", "ackNote", "resolvedAt"), kind?.let { "kind = ?" }, kind?.let { arrayOf(it) }, null, null, "at DESC", limit.toString()).use { c ->
            while (c.moveToNext()) out += CommRow(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getLong(4), c.getString(5), c.getInt(6) == 1, if (c.isNull(7)) null else c.getLong(7), c.getString(8), if (c.isNull(9)) null else c.getLong(9), c.getString(10), if (c.isNull(11)) null else c.getLong(11))
        }
        return out
    }

    /** Alerts the guard sent that operations has not acknowledged yet (for the dashboard badge). */
    @Synchronized
    fun unacknowledgedAlerts(): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM comm_log WHERE kind = 'ALERT' AND status IN ('QUEUED','SENT') AND type IN ('EMERGENCY','NEED_ASSISTANCE','INCIDENT_REPORT','SECURITY_ALERT','RUNNING_LATE')", null).use { it.moveToFirst(); it.getInt(0) }
}
