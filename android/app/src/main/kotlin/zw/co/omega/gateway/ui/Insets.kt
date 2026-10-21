package zw.co.omega.gateway.ui

import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

/**
 * Edge to edge without anything hiding under the system: a view keeps its own padding and adds the
 * status bar, the navigation bar (three-button or gesture) and any camera cutout on top of it.
 * Android 15 draws every app edge to edge regardless, so a screen that does not do this puts its
 * header under the clock and its bottom button under the gesture bar.
 *
 * A screen with a fixed footer pads the root for the top and the sides, and the footer for the
 * bottom, so the footer's own background runs behind the navigation bar.
 */
object Insets {
    fun applySystemBars(view: View, top: Boolean = true, bottom: Boolean = true) {
        val start = view.paddingLeft; val t = view.paddingTop; val end = view.paddingRight; val b = view.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(view) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.updatePadding(left = start + bars.left, top = t + (if (top) bars.top else 0), right = end + bars.right, bottom = b + (if (bottom) bars.bottom else 0))
            insets
        }
        if (view is ViewGroup) view.clipToPadding = false
        ViewCompat.requestApplyInsets(view)
    }
}
