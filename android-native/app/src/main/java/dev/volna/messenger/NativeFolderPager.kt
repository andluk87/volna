package dev.volna.messenger

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.flow.distinctUntilChanged

internal fun nativeFolderKey(folder: NativeFolder) = if(folder.rule=="all") "all" else "folder:${folder.id}"
internal fun nativeFolderPageKeys(folders: List<NativeFolder>, chats: List<VolnaChat>) = nativeNavigationFolders(folders,chats).map(::nativeFolderKey).ifEmpty { listOf("all") }
internal fun nativeVisibleFolderChats(chats: List<VolnaChat>, folders: List<NativeFolder>, filter: String): List<VolnaChat> {
    val tabs=nativeNavigationFolders(folders,chats)
    val folder=tabs.firstOrNull { it.rule!="all"&&nativeFolderKey(it)==filter }
    return chats.filter { if(folder!=null)nativeFolderMatches(folder,it) else nativeChatFilter(it,filter)&&(filter!="all"||tabs.isEmpty()||nativeUnassignedChat(it,tabs)) }
        .let { rows -> if(folder==null)rows else rows.sortedBy { folder.pinned.indexOf(it.id).takeIf{position->position>=0}?:Int.MAX_VALUE } }
}
/** Stable keys retain each folder's list position across swipes, updates and tab switches. */
@Composable
internal fun NativeFolderPager(folders: List<NativeFolder>,chats: List<VolnaChat>,selected: String,onSelect: (String)->Unit,modifier: Modifier=Modifier,content: @Composable (String)->Unit) {
    val keys=nativeFolderPageKeys(folders,chats)
    val pager=rememberPagerState(initialPage=keys.indexOf(selected).coerceAtLeast(0),pageCount={keys.size})
    val state=rememberSaveableStateHolder();val motion=LocalMotionEnabled.current
    val currentSelect by rememberUpdatedState(onSelect)
    var requested by remember { mutableStateOf<String?>(null) }
    var syncing by remember {mutableStateOf(false)}
    LaunchedEffect(selected,keys,requested) {
        val index=keys.indexOf(selected).coerceAtLeast(0)
        if(requested!=null||!pager.isScrollInProgress&&keys.getOrNull(pager.currentPage)!=selected) {
            syncing=true
            try {if(motion)pager.animateScrollToPage(index)else pager.scrollToPage(index)}finally{syncing=false}
            requested=null
        }
    }
    LaunchedEffect(pager,keys) {
        snapshotFlow { if(!syncing&&!pager.isScrollInProgress)pager.settledPage else -1 }.distinctUntilChanged().collect { index -> if(index>=0)keys.getOrNull(index)?.let { currentSelect(it) } }
    }
    Column(modifier) {
        NativeFolderTabs(folders,chats,keys.getOrNull(pager.currentPage)?:selected,pagePosition={pager.currentPage+pager.currentPageOffsetFraction},onSelect={ key ->requested=key;currentSelect(key) })
        HorizontalPager(pager,Modifier.weight(1f).fillMaxWidth().testTag("folder-pager"),key={keys[it]},beyondViewportPageCount=1,userScrollEnabled=keys.size>1) { index ->
            state.SaveableStateProvider(keys[index]) { Box(Modifier.fillMaxSize().testTag("folder-page-${keys[index]}")){content(keys[index])} }
        }
    }
}
