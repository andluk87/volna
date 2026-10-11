package dev.volna.messenger
/** Account reconciliation never ties event subscriptions to the selected UI account. */
internal fun nativeStreamsToStop(accounts: Map<Long,String>, running: Map<Long,String>) = running.filter { (id,token) -> accounts[id] != token }.keys
internal fun nativeNotificationChatVisible(visible: Boolean, visibleAccount: Long, visibleChat: Long, account: Long, chat: Long) = visible && visibleAccount == account && visibleChat == chat
