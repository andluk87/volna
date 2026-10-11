package dev.volna.messenger

import android.graphics.Rect as AndroidRect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus

/** Native selection actions plus the same nine formats as the desktop composer. */
internal class NativeFormattingToolbar(private val view: View, private val format: (String) -> Unit) : TextToolbar {
    private var mode: ActionMode? = null
    override val status: TextToolbarStatus get() = if (mode == null) TextToolbarStatus.Hidden else TextToolbarStatus.Shown
    override fun hide() { mode?.finish(); mode = null }
    override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
        hide()
        val actions = listOf("Копировать" to onCopyRequested, "Вставить" to onPasteRequested, "Вырезать" to onCutRequested, "Выбрать всё" to onSelectAllRequested)
        mode = view.startActionMode(object : ActionMode.Callback2() {
            override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
                actions.forEachIndexed { i, (title, action) -> if (action != null) menu.add(0, i + 1, i, title).setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM) }
                val submenu = menu.addSubMenu("Форматирование")
                nativeFormatOptions.forEachIndexed { i, (_, title) -> submenu.add(0, 100 + i, i, title) }
                return true
            }
            override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = false
            override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
                when (item.itemId) {
                    in 1..4 -> actions[item.itemId - 1].second?.invoke()
                    in 100 until 100 + nativeFormatOptions.size -> format(nativeFormatOptions[item.itemId - 100].first)
                    else -> return false
                }
                mode.finish(); return true
            }
            override fun onDestroyActionMode(mode: ActionMode) { this@NativeFormattingToolbar.mode = null }
            override fun onGetContentRect(mode: ActionMode, view: View, outRect: AndroidRect) {
                val location = IntArray(2); view.getLocationOnScreen(location)
                outRect.set((rect.left-location[0]).toInt(), (rect.top-location[1]).toInt(), (rect.right-location[0]).toInt(), (rect.bottom-location[1]).toInt())
            }
        }, ActionMode.TYPE_FLOATING)
    }
}
