package dev.volna.messenger

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal data class NativeBotCommand(val command:String,val description:String)

@Composable
internal fun NativeBotMenu(commands:List<NativeBotCommand>,enabled:Boolean,onCommand:(String)->Unit){
    if(commands.isEmpty())return
    var open by remember(commands){mutableStateOf(false)}
    Box {
        Button(onClick={open=!open},enabled=enabled,shape=RoundedCornerShape(20.dp),contentPadding=PaddingValues(horizontal=12.dp,vertical=0.dp),modifier=Modifier.height(36.dp),colors=ButtonDefaults.buttonColors(containerColor=Accent,contentColor=AccentText)){NativeText("Меню",fontSize=13.sp)}
        DropdownMenu(expanded=open,onDismissRequest={open=false}){
            commands.forEach { item->DropdownMenuItem(enabled=enabled,text={Column{NativeText(item.command,color=Accent);NativeText(item.description,color=Muted,fontSize=12.sp)}},onClick={open=false;onCommand(item.command)}) }
        }
    }
}
