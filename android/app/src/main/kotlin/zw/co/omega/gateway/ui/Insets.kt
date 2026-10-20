package zw.co.omega.gateway.ui

import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

/**
 * Edge to edge without anything hiding under the system: the screen's root keeps its own padding
 * and adds the status bar, the navigation bar (three-button or gesture) and any camera cutout on
 * top of it. Android 15 draws every app edge to edge regardless, so a screen that does not do this
 * puts its header under the clock and its bottom button under the gesture bar.
 */
object Insets {
    fun applySystemBars(root: View) {
        val start = root.paddingLeft; val top = root.paddingTop; val end = root.paddingRight; val bottom = root.paddingBottom
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.updatePadding(left = start + bars.left, top = top + bars.top, right = end + bars.right, bottom = bottom + bars.bottom)
            insets
        }
        if (root is ViewGroup) root.clipToPadding = false
        ViewCompat.requestApplyInsets(root)
    }
}
