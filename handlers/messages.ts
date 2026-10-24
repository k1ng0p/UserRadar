import { getCurrentChannel } from "@utils/discord"
import { ChannelStore, MessageStore, UserStore } from "@webpack/common"

import { activityStore, logUserActivity } from "../activityStore"
import { pendingTypingLog } from "../caches"
import { TYPING_LOG_TTL_MS } from "../constants"
import { isFeatureOn, labeledName, msgPreview, notify } from "../notify"
import { settings } from "../settings"
import { isWatched } from "../store"
import { MsgCreateEvent, MsgDeleteEvent, MsgUpdateEvent, TypingEvent } from "../types"
import { avatarUrl, guildName, jumpTo, trunc } from "../utils"

export function tryLoadLoggedMsgs() {
    try {
        const plugins = (Vencord as any)?.Plugins?.plugins
        const plugin = plugins?.["vc-message-logger-enhanced"] ?? plugins?.["MessageLoggerEnhanced"]
        return plugin?.loggedMessages ?? plugin?.store?.loggedMessages ?? null
    } catch { return null }
}

export function onMessageCreate({ optimistic, type, message, channelId }: MsgCreateEvent) {
    if (optimistic || type !== "MESSAGE_CREATE") return
    const uid = message.author?.id
    if (!uid || !isWatched(settings, uid)) return
    const typingKey = `${uid}_${channelId}`
    const pendingTyping = pendingTypingLog[typingKey]
    if (pendingTyping) {
        delete pendingTypingLog[typingKey]
        if (pendingTyping.logId && Date.now() - pendingTyping.ts < TYPING_LOG_TTL_MS) {
            activityStore.removeLog(uid, pendingTyping.logId).catch(() => {})
        }
    }
    if (isFeatureOn(uid, "msgs", "globalMsgs")) {
        const dn = labeledName(uid, message.author)
        const ch    = ChannelStore.getChannel(channelId)
        const gName = guildName(ch?.guild_id)
        const chName  = ch?.name || "dm"
        const skipNotify = settings.store.skipCurrentChannel && getCurrentChannel()?.id === channelId
        if (!skipNotify) {
            notify({
                _uid: uid,
                title: `${dn} sent a message`,
                body: msgPreview(message.content, message.attachments?.[0]?.filename),
                icon: avatarUrl(uid, message.author?.avatar, 80),
                onClick: () => jumpTo(ch?.guild_id, channelId, message.id),
            })
        }
        logUserActivity(uid, "msg", "💬", `sent a message`, msgPreview(message.content, message.attachments?.[0]?.filename), {
            guildId: ch?.guild_id,
            channelId,
            msgId: message.id,
            metadata: {
                server: gName || "Direct Message",
                channel: chName,
                content: message.content,
            }
        }).catch(() => {})

    }
}

export function onMessageUpdate({ message }: MsgUpdateEvent) {
    const uid = message?.author?.id
    if (!uid || !isWatched(settings, uid)) return

    // edited_timestamp = real edit, not embed/pin/reaction
    if (!message.edited_timestamp) return
    // embeds and pins resend the old edit timestamp, only a fresh one is a real edit
    if (Date.now() - Date.parse(message.edited_timestamp) > 60_000) return

    if (!isFeatureOn(uid, "edits", "globalEdits")) return

    const dn = labeledName(uid, message.author)
    const ch    = ChannelStore.getChannel(message.channel_id)
    const gName = guildName(ch?.guild_id)
    const chName = ch?.name || "dm"

    const skipNotify = settings.store.skipCurrentChannel && getCurrentChannel()?.id === message.channel_id

    // MessageStore still holds the pre-edit content at this point
    const cached = MessageStore.getMessage(message.channel_id, message.id)
    if (cached && cached.content === message.content) return
    const beforeContent = cached?.content && cached.content !== message.content
        ? cached.content
        : null
    const afterContent = message.content || null

    const notifyBody = beforeContent
        ? `"${trunc(beforeContent, 60)}" → "${trunc(afterContent || "", 60)}"`
        : afterContent ? `"${trunc(afterContent, 60)}"` : "click to view"

    if (!skipNotify) {
        notify({
            _uid: uid,
            title: `${dn} edited a message`,
            body: notifyBody,
            icon: avatarUrl(uid, (message.author as any)?.avatar, 80),
            onClick: () => jumpTo(ch?.guild_id, message.channel_id, message.id),
        })
    }
    logUserActivity(uid, "edit", "✏️", `edited a message`, "", {
        guildId: ch?.guild_id,
        channelId: message.channel_id,
        msgId: message.id,
        metadata: {
            server: gName || "Direct Message",
            channel: chName,
            before: beforeContent,
            after: afterContent,
        }
    }).catch(() => {})

}

export function onMessageDelete({ id, channelId }: MsgDeleteEvent) {
    const store = tryLoadLoggedMsgs()
    // try discord cache, then message logger (both key formats)
    const msg = MessageStore.getMessage(channelId, id)
        ?? store?.[id]
        ?? (store as any)?.[channelId]?.[id]
    if (!msg?.author) return
    const uid = msg.author.id
    if (!isWatched(settings, uid)) return
    if (isFeatureOn(uid, "deletes", "globalDeletes")) {
        const dn = labeledName(uid, msg.author)
        const ch    = ChannelStore.getChannel(channelId)
        const gName = guildName(ch?.guild_id)
        const chName  = ch?.name || "dm"
        const skipNotify = settings.store.skipCurrentChannel && getCurrentChannel()?.id === channelId
        if (!skipNotify) {
            notify({
                _uid: uid,
                title: `${dn} deleted a message`,
                body: msgPreview(msg.content, msg.attachments?.[0]?.filename),
                icon: avatarUrl(uid, msg.author?.avatar, 80),
                onClick: () => jumpTo(ch?.guild_id, channelId, msg.id),
            })
        }
        logUserActivity(uid, "delete", "🗑️", `deleted a message`, msgPreview(msg.content, msg.attachments?.[0]?.filename), {
            guildId: ch?.guild_id,
            channelId,
            msgId: msg.id,
            metadata: {
                server: gName || "Direct Message",
                channel: chName,
            }
        }).catch(() => {})
    }
}

// discord resends typing about every 10s while someone keeps typing,
// one card per burst is enough
const TYPING_BURST_MS = 30 * 1000

export function onTypingStart({ channelId, userId }: TypingEvent) {
    if (!isWatched(settings, userId)) return
    if (!isFeatureOn(userId, "typing", "globalTyping")) return

    const key = `${userId}_${channelId}`
    const now = Date.now()
    const pending = pendingTypingLog[key]
    if (pending && now - pending.ts < TYPING_BURST_MS) {
        pending.ts = now
        return
    }
    // claimed right away, the card itself is written a moment later
    const slot = { logId: "", ts: now }
    pendingTypingLog[key] = slot

    const u = UserStore.getUser(userId)
    const dn = labeledName(userId, u)
    const ch = ChannelStore.getChannel(channelId)
    const gName = guildName(ch?.guild_id)
    const chName = ch?.name || "dm"
    // for DMs, ch.name is null so show recipient context instead
    const location = gName
        ? `${gName} · #${chName}`
        : ch?.recipients?.length
            ? "Direct Message"
            : `#${chName}`
    const skipNotify = settings.store.skipCurrentChannel && getCurrentChannel()?.id === channelId
    if (!skipNotify) {
        notify({
            _uid: userId,
            title: `${dn} is typing…`,
            body: location,
            icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
            onClick: () => jumpTo(ch?.guild_id, channelId),
        })
    }
    logUserActivity(userId, "typing", "💭", `is typing…`, "", {
        guildId: ch?.guild_id,
        channelId,
        metadata: {
            server: gName || "Direct Message",
            channel: chName,
        }
    }).then(entry => {
        // they already sent their message while the card was being written
        if (pendingTypingLog[key] !== slot) activityStore.removeLog(userId, entry.id).catch(() => { })
        else slot.logId = entry.id
    }).catch(() => {
        if (pendingTypingLog[key] === slot) delete pendingTypingLog[key]
    })
}
