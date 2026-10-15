package dev.volna.messenger

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

/** Measure the body once, then let the footer span at least its actual width. */
@Composable
internal fun NativeBubbleContent(modifier: Modifier, body: @Composable ColumnScope.() -> Unit, footer: @Composable () -> Unit) {
    Layout(modifier = modifier, content = {
        Column(content = body)
        Box(propagateMinConstraints = true) { footer() }
    }) { nodes, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val bodyPlaceable = nodes[0].measure(loose)
        val footerPlaceable = nodes[1].measure(loose.copy(minWidth = bodyPlaceable.width))
        val width = constraints.constrainWidth(maxOf(bodyPlaceable.width, footerPlaceable.width))
        val height = constraints.constrainHeight(bodyPlaceable.height + footerPlaceable.height)
        layout(width, height) {
            bodyPlaceable.placeRelative(0, 0)
            footerPlaceable.placeRelative(0, bodyPlaceable.height)
        }
    }
}

/** Short text shares a line with time. Reaction chips wrap while reserving room for time. */
@Composable
internal fun NativeMessagePair(wrapReactions: Boolean = false, content: @Composable () -> Unit, stamp: @Composable () -> Unit) {
    Layout(content = {
        Box { content() }
        Box { stamp() }
    }) { nodes, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val meta = nodes[1].measure(loose)
        val gap = if (meta.width > 0) 8.dp.roundToPx() else 0
        val beside = wrapReactions || nodes[0].maxIntrinsicWidth(Constraints.Infinity) <= (loose.maxWidth - meta.width - gap).coerceAtLeast(0)
        val body = nodes[0].measure(loose.copy(maxWidth = if (beside) (loose.maxWidth - meta.width - gap).coerceAtLeast(0) else loose.maxWidth))
        val actualGap = if (body.width > 0) gap else 0
        val width = constraints.constrainWidth(if (beside) body.width + actualGap + meta.width else maxOf(body.width, meta.width))
        val height = constraints.constrainHeight(if (beside) maxOf(body.height, meta.height) else body.height + meta.height)
        layout(width, height) {
            body.placeRelative(0, 0)
            meta.placeRelative(width - meta.width, height - meta.height)
        }
    }
}
