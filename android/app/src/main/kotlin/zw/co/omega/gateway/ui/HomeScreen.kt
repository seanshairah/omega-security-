package zw.co.omega.gateway.ui

import android.content.Context
import android.content.res.ColorStateList
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import zw.co.omega.gateway.R
import zw.co.omega.gateway.data.EventQueue
import zw.co.omega.gateway.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Everything the home screen shows, gathered in one place so the screen can be drawn from facts a
 * test makes up (see src/screenshotTest) as well as from the phone's own state (MainActivity).
 * Nothing here reads preferences or the system: MainActivity does that and hands it over.
 */
data class HomeFacts(
    val guardMode: Boolean,
    val appState: AppState,
    val guardName: String,
    val deviceName: String,
    /** "mobile", "wifi", "none" or anything else. */
    val network: String,
    val isOnline: Boolean,
    val heartbeatOk: Boolean,
    val authRejected: Boolean,
    val lastError: String?,
    /** "background", "foreground_only" or "denied". */
    val locationPermission: String,
    val canMonitorCalls: Boolean,
    val canSeeNumbers: Boolean,
    val batteryRestricted: Boolean,
    val queued: Int,
    val rejected: Int,
    val lastSyncAt: Long,
    val lastHeartbeatAt: Long,
    val syncState: String,
    val lastSyncError: String?,
    val shift: HomeShift?,
    val gpsChecking: Boolean,
    val gpsState: String,
    val gpsReason: String?,
    val lastCheckAt: Long,
    val lastFixAt: Long,
    val lastAttemptAt: Long,
    val lastFixAccuracy: Float,
    val lastFixDistanceM: Float,
    val batterySaver: Boolean,
    val unacknowledged: Int,
    val recent: List<EventQueue.CommRow>,
    val lastCallSummary: String?,
    val lastCallAt: Long,
    val calls: List<EventQueue.CommRow>,
    val now: Long,
    /** How often the phone heartbeats; three missed in a row is "not heard from". */
    val heartbeatSeconds: Int = 120,
)

data class HomeShift(
    val startAtMs: Long,
    val endAtMs: Long,
    val active: Boolean,
    val upcoming: Boolean,
    val siteName: String?,
    val siteHasCoordinates: Boolean,
    val radiusM: Int,
    val shiftFence: Boolean,
    val testCoordinates: Boolean,
    val configVersion: String?,
    val checkMinutes: Int,
    val outsideCheckMinutes: Int,
    val accuracyMaxM: Int,
)

object HomeScreen {

    fun bind(ctx: Context, b: ActivityMainBinding, f: HomeFacts) {
        val conn = connectionView(f.authRejected, f.isOnline, f.heartbeatOk, f.lastHeartbeatAt, f.heartbeatSeconds, f.now)
        val net = when (f.network) { "mobile" -> ctx.getString(R.string.net_mobile); "wifi" -> ctx.getString(R.string.net_wifi); "none" -> ctx.getString(R.string.net_none); else -> ctx.getString(R.string.net_other) }
        val permissionProblem = f.appState == AppState.PERMISSIONS_INCOMPLETE || f.appState == AppState.PERMISSION_REVOKED

        // ---- Header ----
        b.headerTitle.text = if (f.guardMode) f.guardName.ifBlank { f.deviceName.ifBlank { ctx.getString(R.string.guard_phone) } } else f.deviceName.ifBlank { ctx.getString(R.string.header_ops_title) }
        b.headerSub.text = ctx.getString(if (f.guardMode) R.string.header_sub_guard else R.string.header_sub_ops, net)
        val (chipWord, chipTone) = when {
            conn == ConnectionView.REVOKED -> R.string.chip_revoked to Tone.CRITICAL
            permissionProblem -> R.string.chip_action to Tone.WARN
            conn == ConnectionView.ONLINE -> R.string.chip_online to Tone.OK
            conn == ConnectionView.NO_INTERNET -> R.string.chip_no_internet to Tone.WARN
            conn == ConnectionView.NOT_HEARD -> R.string.chip_not_heard to Tone.WARN
            else -> R.string.chip_reconnecting to Tone.WARN
        }
        chip(ctx, b.connChip, ctx.getString(chipWord), chipTone)

        // ---- Attention: one banner, only when something needs doing ----
        val attention = when (f.appState) {
            AppState.REACTIVATION_REQUIRED -> ctx.getString(R.string.attn_revoked)
            AppState.PERMISSIONS_INCOMPLETE, AppState.PERMISSION_REVOKED -> when {
                f.guardMode && f.locationPermission != "background" -> ctx.getString(R.string.attn_location)
                !f.canMonitorCalls -> ctx.getString(R.string.attn_phone)
                !f.canSeeNumbers -> ctx.getString(R.string.attn_call_log)
                else -> ctx.getString(R.string.attn_phone)
            }
            AppState.READY -> when {
                conn == ConnectionView.NO_INTERNET && f.queued > 0 -> ctx.resources.getQuantityString(R.plurals.attn_no_internet, f.queued, f.queued)
                conn == ConnectionView.NOT_HEARD -> ctx.getString(R.string.attn_not_heard, time(f.lastHeartbeatAt))
                f.batteryRestricted -> ctx.getString(R.string.attn_battery)
                else -> ""
            }
            AppState.NOT_ACTIVATED -> ""
        }
        b.connection.text = attention
        b.permissions.visibility = if (permissionProblem) View.VISIBLE else View.GONE
        b.battery.visibility = if (f.batteryRestricted && f.appState == AppState.READY) View.VISIBLE else View.GONE
        b.attention.visibility = if (attention.isBlank()) View.GONE else View.VISIBLE
        b.attention.setBackgroundResource(if (f.appState == AppState.REACTIVATION_REQUIRED) R.drawable.bg_banner_red else R.drawable.bg_banner_amber)

        // ---- Sync footer (both modes) ----
        val facts = statusFacts(f)
        val sv = syncView(facts)
        b.syncLine.text = ctx.getString(when (sv) {
            SyncView.REVOKED -> R.string.sync_short_revoked; SyncView.NO_INTERNET -> R.string.sync_short_no_internet; SyncView.SENDING -> R.string.sync_short_sending
            SyncView.RETRY_PENDING -> R.string.sync_short_retry; SyncView.QUEUED -> R.string.sync_short_queued; SyncView.SYNCED_WITH_FAILURES -> R.string.sync_short_failures
            SyncView.SYNCED -> R.string.sync_short_synced; SyncView.WAITING -> R.string.sync_short_waiting
        })
        val q = f.queued
        b.syncDetail.text = when (sv) {
            SyncView.REVOKED -> ctx.getString(R.string.sync_detail_revoked)
            SyncView.NO_INTERNET -> ctx.resources.getQuantityString(R.plurals.events_saved_on_phone, q, q)
            SyncView.SENDING -> ctx.resources.getQuantityString(R.plurals.events_sending, q, q)
            SyncView.RETRY_PENDING -> ctx.resources.getQuantityString(R.plurals.events_retrying, q, q, f.lastSyncError ?: "")
            SyncView.QUEUED -> ctx.resources.getQuantityString(R.plurals.events_queued, q, q)
            SyncView.SYNCED_WITH_FAILURES -> ctx.getString(R.string.sync_detail_failures)
            SyncView.SYNCED -> (if (f.lastSyncAt > 0) ctx.getString(R.string.sync_detail_sent, time(f.lastSyncAt)) else ctx.getString(R.string.sync_detail_nothing)) +
                (if (f.lastHeartbeatAt > 0) ctx.getString(R.string.sync_footer_heartbeat, time(f.lastHeartbeatAt)) else "")
            SyncView.WAITING -> ctx.getString(R.string.sync_detail_waiting, f.lastError ?: "")
        }.replaceFirstChar { it.uppercase() }
        b.syncIcon.setImageResource(when (sv) { SyncView.SYNCED -> R.drawable.ic_check_circle; SyncView.SENDING -> R.drawable.ic_sync; SyncView.REVOKED -> R.drawable.ic_lock; SyncView.NO_INTERNET -> R.drawable.ic_offline; else -> R.drawable.ic_clock })
        b.syncIcon.setColorFilter(ctx.getColor(strong(syncTone(sv))))

        b.guardRows.visibility = if (f.guardMode) View.VISIBLE else View.GONE
        b.opsRows.visibility = if (f.guardMode) View.GONE else View.VISIBLE
        if (f.guardMode) bindGuard(ctx, b, f, facts) else bindOps(ctx, b, f)
    }

    private fun bindGuard(ctx: Context, b: ActivityMainBinding, f: HomeFacts, facts: StatusFacts) {
        val s = f.shift
        // ---- Shift: the primary area ----
        when {
            s != null && s.active -> {
                chip(ctx, b.shiftState, ctx.getString(R.string.shift_state_on), Tone.OK)
                b.shiftTime.text = ctx.getString(R.string.shift_hours, time(s.startAtMs), time(s.endAtMs))
                b.shiftSub.text = ctx.getString(R.string.shift_on_sub, day(ctx, s.endAtMs, f.now, lower = true), time(s.endAtMs))
            }
            s != null && s.upcoming -> {
                chip(ctx, b.shiftState, ctx.getString(R.string.shift_state_next), Tone.INFO)
                b.shiftTime.text = ctx.getString(R.string.shift_hours, time(s.startAtMs), time(s.endAtMs))
                b.shiftSub.text = ctx.getString(R.string.shift_next_sub, day(ctx, s.startAtMs, f.now))
            }
            else -> {
                chip(ctx, b.shiftState, ctx.getString(R.string.shift_state_none), Tone.NEUTRAL)
                b.shiftTime.text = ctx.getString(R.string.shift_off_title)
                b.shiftSub.text = ctx.getString(R.string.shift_none_sub)
            }
        }
        b.shiftSub.visibility = View.VISIBLE
        when {
            s == null -> { b.dutySiteName.text = ctx.getString(R.string.duty_site_none_title); b.dutySiteMeta.text = "—" }
            !s.siteHasCoordinates -> { b.dutySiteName.text = s.siteName ?: ctx.getString(R.string.duty_site_none_title); b.dutySiteMeta.text = ctx.getString(R.string.duty_site_no_coordinates) }
            else -> {
                b.dutySiteName.text = s.siteName ?: "—"
                b.dutySiteMeta.text = (ctx.getString(R.string.duty_site_meta, s.radiusM) + (if (s.shiftFence) ctx.getString(R.string.duty_site_override) else "") +
                    (if (s.testCoordinates && !s.shiftFence) ctx.getString(R.string.duty_site_test) else "")).replaceFirstChar { it.uppercase() }
            }
        }

        // Where the phone's last reading put the guard. Worded as the phone's reading, not as the
        // portal's verdict: the server decides attendance, and says so on the portal.
        val gv = gpsView(facts)
        b.presenceRow.visibility = if (gv == GpsView.OFF) View.GONE else View.VISIBLE
        b.presenceText.text = when (gv) {
            GpsView.INSIDE -> ctx.getString(R.string.presence_inside, time(if (f.lastFixAt > 0) f.lastFixAt else f.lastCheckAt))
            GpsView.CHECKING -> ctx.getString(R.string.presence_checking)
            GpsView.OUTSIDE_VERIFYING -> ctx.getString(R.string.presence_verifying)
            GpsView.OUTSIDE -> ctx.getString(R.string.presence_outside)
            else -> ctx.getString(R.string.presence_unknown)
        }
        val tone = gpsTone(gv)
        b.presenceIcon.setImageResource(when (gv) { GpsView.INSIDE -> R.drawable.ic_verified; GpsView.OUTSIDE -> R.drawable.ic_warning; GpsView.CHECKING -> R.drawable.ic_my_location; else -> R.drawable.ic_exclaim })
        b.presenceIcon.setColorFilter(ctx.getColor(strong(tone)))
        b.presenceRow.backgroundTintList = ColorStateList.valueOf(ctx.getColor(soft(tone)))

        // ---- Location ----
        b.gpsLine.text = ctx.getString(when (gv) { GpsView.OFF -> R.string.gps_title_off; GpsView.CHECKING -> R.string.gps_title_checking; GpsView.INSIDE -> R.string.gps_title_inside; GpsView.OUTSIDE_VERIFYING -> R.string.gps_title_verifying; GpsView.OUTSIDE -> R.string.gps_title_outside; GpsView.UNKNOWN -> R.string.gps_title_unknown })
        val limit = s?.accuracyMaxM ?: 100
        val reason = when (gpsReasonKind(f.gpsReason, f.lastCheckAt)) {
            GpsReasonKind.NONE -> ""
            GpsReasonKind.NOT_CHECKED_YET -> if (facts.shift == ShiftView.ACTIVE) ctx.getString(R.string.gps_reason_not_checked) else ""
            GpsReasonKind.NO_FIX -> ctx.getString(R.string.gps_reason_no_fix)
            GpsReasonKind.POOR_ACCURACY -> ctx.getString(R.string.gps_reason_poor_accuracy, formatAccuracy(f.lastFixAccuracy), limit)
            GpsReasonKind.LOCATION_OFF -> ctx.getString(R.string.gps_reason_location_off)
            GpsReasonKind.PERMISSION -> ctx.getString(R.string.gps_reason_permission)
            GpsReasonKind.SITE_NO_COORDINATES -> ctx.getString(R.string.gps_reason_site)
            GpsReasonKind.ON_BOUNDARY -> ctx.getString(R.string.gps_reason_boundary, formatAccuracy(f.lastFixAccuracy))
        }
        b.gpsReasonLine.text = when (gv) {
            GpsView.UNKNOWN -> reason
            GpsView.OFF -> ctx.getString(R.string.gps_sub_off)
            GpsView.CHECKING -> ctx.getString(R.string.gps_sub_checking)
            GpsView.INSIDE -> ctx.getString(R.string.gps_sub_inside)
            GpsView.OUTSIDE_VERIFYING -> ctx.getString(R.string.gps_sub_verifying)
            GpsView.OUTSIDE -> ctx.getString(R.string.gps_sub_outside)
        }
        b.gpsReasonLine.visibility = if (b.gpsReasonLine.text.isBlank()) View.GONE else View.VISIBLE
        b.gpsIcon.setImageResource(when (gv) { GpsView.INSIDE -> R.drawable.ic_check; GpsView.OUTSIDE -> R.drawable.ic_warning; GpsView.CHECKING -> R.drawable.ic_my_location; GpsView.OFF -> R.drawable.ic_pause; else -> R.drawable.ic_exclaim })
        b.gpsIconWrap.setBackgroundResource(when (tone) { Tone.OK, Tone.INFO -> R.drawable.circle_green_soft; Tone.WARN -> R.drawable.circle_amber_soft; Tone.CRITICAL -> R.drawable.circle_red_soft; Tone.NEUTRAL -> R.drawable.circle_grey_soft })
        b.gpsIcon.setColorFilter(ctx.getColor(strong(tone)))
        b.gpsMeta.text = when {
            f.lastFixAt > 0 -> ctx.getString(R.string.gps_meta, time(f.lastFixAt), formatDistance(f.lastFixDistanceM), formatAccuracy(f.lastFixAccuracy), limit)
            f.lastAttemptAt > 0 -> ctx.getString(R.string.gps_meta_no_fix, time(f.lastAttemptAt), limit)
            else -> ctx.getString(R.string.gps_meta_none)
        }
        b.gpsMeta.visibility = if (gv == GpsView.OFF && f.lastFixAt <= 0) View.GONE else View.VISIBLE
        val every = s?.checkMinutes ?: 10
        b.monitoringLine.text = when {
            facts.shift != ShiftView.ACTIVE -> ctx.getString(R.string.mon_off_line)
            f.locationPermission != "background" -> ctx.getString(R.string.mon_fg_only_line)
            f.gpsState == "OUTSIDE" || f.gpsState == "VERIFYING_OUTSIDE" -> ctx.getString(R.string.mon_outside_line, s?.outsideCheckMinutes ?: 3)
            f.batterySaver -> ctx.getString(R.string.mon_saver_line, every * 2)
            else -> ctx.getString(R.string.mon_on_line, every)
        }
        b.checkNow.text = ctx.getString(if (f.gpsChecking) R.string.gps_title_checking else R.string.check_location_now)

        // ---- Alerts waiting, and what was sent ----
        b.unackedLine.visibility = if (f.unacknowledged > 0) View.VISIBLE else View.GONE
        b.unackedLine.text = ctx.resources.getQuantityString(R.plurals.alerts_waiting, f.unacknowledged, f.unacknowledged)
        b.commList.removeAllViews()
        if (f.recent.isEmpty()) b.commList.addView(commRow(ctx, R.drawable.ic_doc, Tone.NEUTRAL, ctx.getString(R.string.comm_none_title), ctx.getString(R.string.comm_none_body), R.color.ink3))
        val df = SimpleDateFormat("HH:mm", Locale.getDefault())
        for (r in f.recent.take(3)) {
            val label = if (r.kind == "ALERT" || r.kind == "operations") AlertsActivity.labelFor(r.type) else r.summary ?: r.type
            val emergency = r.type == "EMERGENCY"
            val acked = r.status == "ACKNOWLEDGED" || r.status == "RESOLVED"
            b.commList.addView(commRow(ctx,
                when { emergency -> R.drawable.ic_warning; r.kind == "CALL" -> R.drawable.ic_phone; r.kind == "operations" -> R.drawable.ic_my_location; else -> R.drawable.ic_doc },
                when { emergency -> Tone.CRITICAL; acked -> Tone.OK; else -> Tone.NEUTRAL },
                "${df.format(Date(r.at))} · $label", AlertsActivity.commStateText(ctx, r), AlertsActivity.commStateColour(r)))
        }
    }

    private fun bindOps(ctx: Context, b: ActivityMainBinding, f: HomeFacts) {
        val tone = when { !f.canMonitorCalls -> Tone.CRITICAL; !f.canSeeNumbers -> Tone.WARN; else -> Tone.OK }
        b.callIconWrap.setBackgroundResource(when (tone) { Tone.CRITICAL -> R.drawable.circle_red_soft; Tone.WARN -> R.drawable.circle_amber_soft; else -> R.drawable.circle_green_soft })
        b.callIcon.setColorFilter(ctx.getColor(strong(tone)))
        b.callMonitorTitle.text = ctx.getString(when { !f.canMonitorCalls -> R.string.call_mon_title_off; !f.canSeeNumbers -> R.string.call_mon_title_partial; else -> R.string.call_mon_title_active })
        b.callMonitorLine.text = ctx.getString(when { !f.canMonitorCalls -> R.string.call_line_no_permission; !f.canSeeNumbers -> R.string.call_line_no_numbers; else -> R.string.call_line_active })
        b.lastCall.text = f.lastCallSummary?.let { "$it · ${time(f.lastCallAt)}" } ?: ctx.getString(R.string.no_calls_yet)
        val df = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault())
        b.opsCalls.removeAllViews()
        if (f.calls.isEmpty()) b.opsCalls.addView(text(ctx, ctx.getString(R.string.no_calls_yet), R.color.ink3, 14f, false))
        for (r in f.calls.take(6)) {
            val state = when (r.status) { "QUEUED" -> ctx.getString(R.string.delivery_queued); "FAILED" -> ctx.getString(R.string.delivery_failed); else -> ctx.getString(R.string.delivery_sent, df.format(Date(r.sentAt ?: r.at))) }
            b.opsCalls.addView(commRow(ctx, R.drawable.ic_phone, if (r.status == "FAILED") Tone.CRITICAL else if (r.status == "QUEUED") Tone.WARN else Tone.NEUTRAL,
                "${df.format(Date(r.at))} · ${r.summary ?: r.type}", state, if (r.status == "QUEUED") R.color.warn_strong else if (r.status == "FAILED") R.color.critical else R.color.ink2))
        }
    }

    fun statusFacts(f: HomeFacts) = StatusFacts(
        when { f.shift?.active == true -> ShiftView.ACTIVE; f.shift?.upcoming == true -> ShiftView.UPCOMING; else -> ShiftView.NONE },
        f.gpsChecking, f.gpsState, f.gpsReason, f.lastCheckAt, f.isOnline, f.authRejected, f.queued, f.lastSyncAt, f.heartbeatOk, f.syncState,
    )

    /** A chip: soft background, strong dot and word, all from one tone. */
    private fun chip(ctx: Context, v: TextView, word: String, tone: Tone) {
        v.text = word
        v.backgroundTintList = ColorStateList.valueOf(ctx.getColor(soft(tone)))
        v.setTextColor(ctx.getColor(strong(tone)))
        v.compoundDrawableTintList = ColorStateList.valueOf(ctx.getColor(strong(tone)))
    }

    private fun commRow(ctx: Context, icon: Int, tone: Tone, title: String, state: String, stateColour: Int): View {
        val d = ctx.resources.displayMetrics.density
        val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, (8 * d).toInt(), 0, (8 * d).toInt()) }
        val wrap = FrameLayout(ctx).apply {
            setBackgroundResource(when (tone) { Tone.OK, Tone.INFO -> R.drawable.circle_green_soft; Tone.WARN -> R.drawable.circle_amber_soft; Tone.CRITICAL -> R.drawable.circle_red_soft; Tone.NEUTRAL -> R.drawable.circle_grey_soft })
            layoutParams = LinearLayout.LayoutParams((36 * d).toInt(), (36 * d).toInt())
        }
        wrap.addView(ImageView(ctx).apply { setImageResource(icon); setColorFilter(ctx.getColor(strong(tone))); layoutParams = FrameLayout.LayoutParams((18 * d).toInt(), (18 * d).toInt(), Gravity.CENTER) })
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = (12 * d).toInt() } }
        col.addView(text(ctx, title, R.color.ink, 14f, true))
        col.addView(text(ctx, state, stateColour, 12.5f, false))
        row.addView(wrap); row.addView(col)
        return row
    }

    private fun text(ctx: Context, s: String, colour: Int, size: Float, bold: Boolean) = TextView(ctx).apply {
        text = s; setTextColor(ctx.getColor(colour)); textSize = size
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    fun strong(t: Tone): Int = when (t) { Tone.OK -> R.color.accent_strong; Tone.INFO -> R.color.info; Tone.WARN -> R.color.warn_strong; Tone.CRITICAL -> R.color.critical; Tone.NEUTRAL -> R.color.ink2 }
    fun soft(t: Tone): Int = when (t) { Tone.OK -> R.color.accent_soft; Tone.INFO -> R.color.info_soft; Tone.WARN -> R.color.warn_soft; Tone.CRITICAL -> R.color.critical_soft; Tone.NEUTRAL -> R.color.surface3 }

    private fun time(ms: Long): String = if (ms <= 0) "—" else SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))

    /** "Today", "Tomorrow" or "Tue 21 Oct", for a shift that may not be today's. */
    private fun day(ctx: Context, ms: Long, now: Long, lower: Boolean = false): String {
        val a = Calendar.getInstance().apply { timeInMillis = now }
        val c = Calendar.getInstance().apply { timeInMillis = ms }
        val days = (c.get(Calendar.YEAR) - a.get(Calendar.YEAR)) * 366 + (c.get(Calendar.DAY_OF_YEAR) - a.get(Calendar.DAY_OF_YEAR))
        val word = when (days) { 0 -> ctx.getString(R.string.day_today); 1 -> ctx.getString(R.string.day_tomorrow); else -> return SimpleDateFormat("EEE d MMM", Locale.getDefault()).format(Date(ms)) }
        return if (lower) word.lowercase(Locale.getDefault()) else word
    }
}
