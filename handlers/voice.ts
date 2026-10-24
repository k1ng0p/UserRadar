import { openUserProfile } from "@utils/discord"
import { findByProps } from "@webpack"
import { ChannelStore, UserStore } from "@webpack/common"

import { activityStore, logUserActivity } from "../activityStore"
import { cameraCache, clientCache, streamCache, vcCache, vcJoinTime } from "../caches"
import { CLIENT_LABEL_MAP } from "../constants"
import { isFeatureOn, labeledName, notify } from "../notify"
import { activeSessions, scheduleSessionSave, Session, sessionKey, settleOpen, trackOpen } from "../sessions"
import { settings } from "../settings"
import { isWatched, log } from "../store"
import { VoiceStateEvent } from "../types"
import { avatarUrl, formatDuration, guildName, jumpTo } from "../utils"

type VoiceState = VoiceStateEvent["voiceStates"][number]

const MEDIA = {
    camera: {
        cache: cameraCache, icon: "📷", on: "turned on camera", off: "turned off camera",
        logTitle: "camera on", onAction: "camera_on", sessAction: "camera_session", sessTitle: "Camera on",
    },
    stream: {
        cache: streamCache, icon: "🖥️", on: "started screen sharing", off: "stopped screen sharing",
        logTitle: "screen sharing", onAction: "stream_on", sessAction: "stream_session", sessTitle: "Screen sharing",
    },
} as const

const platformOf = (uid: string) => {
    const c = clientCache[uid]
    return c ? CLIENT_LABEL_MAP[c] || c : undefined
}

function otherMembers(channelId: string, uid: string): string[] {
    if (!settings.store.logVcMembers) return []
    try {
        const raw = findByProps("getVoiceStatesForChannel")?.getVoiceStatesForChannel?.(channelId)
        if (!raw) return []
        const states: any[] = raw instanceof Map ? [...raw.values()] : Object.values(raw)
        return states
            .filter(s => s?.userId && s.userId !== uid)
            .map(s => { const m = UserStore.getUser(s.userId); return m ? (m.globalName || m.username) : s.userId })
    } catch { return [] }
}

// writes the log card for a session start and registers the session once the card exists
async function openSession(uid: string, sk: string, icon: string, title: string, body: string, opts: {
    guildId?: string
    channelId?: string
    logMeta: Record<string, any>
    sessMeta: Record<string, any>
}) {
    const entry = await trackOpen(sk, logUserActivity(uid, "voice", icon, title, body, {
        guildId: opts.guildId, channelId: opts.channelId, metadata: opts.logMeta,
    }))
    activeSessions[sk] = { logId: entry.id, startTime: Date.now(), channelId: opts.channelId, guildId: opts.guildId, metadata: opts.sessMeta }
    scheduleSessionSave()
}

// turns the card that opened a session into its final session card
async function endSession(
    uid: string,
    sk: string,
    build: (dur: string, sess: Session) => { title: string; metadata?: Record<string, any> },
): Promise<{ dur: string } | null> {
    await settleOpen(sk)
    const sess = activeSessions[sk]
    if (!sess) return null
    delete activeSessions[sk]
    scheduleSessionSave()

    const spent = Date.now() - sess.startTime
    const dur = spent > 60000 ? formatDuration(spent) : ""
    const { title, metadata } = build(dur, sess)
    try {
        await activityStore.updateLog(uid, sess.logId, {
            type: "session",
            title,
            body: "",
            metadata: { ...sess.metadata, ...metadata, startTime: sess.startTime, endTime: Date.now(), duration: dur || "< 1m" },
        })
    } catch (e) { log.warn("failed to close session", e) }
    return { dur }
}

const closeVoiceSession = (uid: string, channelId: string, chName: string, gName: string | null) =>
    endSession(uid, sessionKey(uid, "voice", channelId), (_dur, s) => ({
        title: `In #${chName}`,
        metadata: {
            action: "voice_session",
            platform: s.metadata?.platform || platformOf(uid),
            appName: s.metadata?.appName || gName || "Discord",
        },
    }))

async function endMedia(uid: string, kind: keyof typeof MEDIA) {
    const m = MEDIA[kind]
    return endSession(uid, sessionKey(uid, kind), dur => ({
        title: dur ? `${m.sessTitle} · ${dur}` : m.sessTitle,
        metadata: { action: m.sessAction },
    }))
}

async function toggleMedia(uid: string, kind: keyof typeof MEDIA, isOn: boolean, dn: string, icon: string | undefined, channelId: string) {
    const m = MEDIA[kind]
    if ((m.cache[uid] ?? false) === isOn) return
    m.cache[uid] = isOn

    const ch = ChannelStore.getChannel(channelId)
    const chName = ch?.name || "unknown"
    const guildId = ch?.guild_id

    if (isOn) {
        notify({ _uid: uid, title: `${dn} ${m.on}`, body: `in #${chName}`, icon, onClick: () => jumpTo(guildId, channelId) })
        const server = guildName(guildId) || "DM"
        const platform = platformOf(uid)
        await openSession(uid, sessionKey(uid, kind), m.icon, m.logTitle, "", {
            guildId,
            channelId,
            logMeta: { server, channel: chName, action: m.onAction, platform },
            sessMeta: { server, channel: chName, platform },
        })
    } else {
        const closed = await endMedia(uid, kind)
        notify({
            _uid: uid,
            title: `${dn} ${m.off}`,
            body: `in #${chName}${closed?.dur ? " · " + closed.dur : ""}`,
            icon,
            onClick: () => jumpTo(guildId, channelId),
        })
    }
}

async function joinVoice(uid: string, channelId: string, dn: string, icon: string | undefined) {
    const ch = ChannelStore.getChannel(channelId)
    const chName = ch?.name || "unknown"
    const gName = guildName(ch?.guild_id)
    const sk = sessionKey(uid, "voice", channelId)

    vcJoinTime[uid] = Date.now()
    notify({
        _uid: uid,
        title: `${dn} Joined Voice`,
        body: gName ? `${gName} · #${chName}` : `#${chName}`,
        icon,
        onClick: () => jumpTo(ch?.guild_id, channelId),
    })

    // close any orphaned session sitting here first
    await endSession(uid, sk, (_d, s) => ({ title: s.metadata?.channel ? `Was in #${s.metadata.channel}` : "Session ended" }))

    const members = otherMembers(channelId, uid)
    const platform = platformOf(uid)
    const server = gName || "DM"
    await openSession(uid, sk, "🎙️", `joined #${chName}`, platform ? `on ${platform}` : "", {
        guildId: ch?.guild_id,
        channelId,
        logMeta: { server, channel: chName, action: "joined", platform, members: members.length > 0 ? members : undefined },
        sessMeta: { server, channel: chName, platform, members: members.length > 0 ? members : undefined },
    })
}

async function leaveVoice(uid: string, channelId: string, dn: string, icon: string | undefined) {
    const ch = ChannelStore.getChannel(channelId)
    const chName = ch?.name || "unknown"
    const gName = guildName(ch?.guild_id)

    const spent = vcJoinTime[uid] ? Date.now() - vcJoinTime[uid] : 0
    delete vcJoinTime[uid]

    // camera and screen share end with the call, close their cards too
    await endMedia(uid, "camera")
    await endMedia(uid, "stream")
    cameraCache[uid] = false
    streamCache[uid] = false

    const closed = await closeVoiceSession(uid, channelId, chName, gName)
    const dur = closed?.dur || (spent > 60000 ? formatDuration(spent) : "")
    notify({
        _uid: uid,
        title: `${dn} Left Voice`,
        body: `${gName ? `${gName} · ` : ""}#${chName}${closed && dur ? " · " + dur : ""}`,
        icon,
        onClick: () => openUserProfile(uid),
    })

    if (!closed) {
        await logUserActivity(uid, "voice", "🎙️", `left #${chName}`, "", {
            guildId: ch?.guild_id,
            channelId,
            metadata: { server: gName || "DM", channel: chName, action: "left" },
        })
    }
}

async function moveVoice(uid: string, from: string, to: string, dn: string, icon: string | undefined) {
    const fromCh = ChannelStore.getChannel(from)
    const toCh = ChannelStore.getChannel(to)
    const fromName = fromCh?.name || "?"
    const toName = toCh?.name || "unknown"
    const gName = guildName(toCh?.guild_id)

    await closeVoiceSession(uid, from, fromName, guildName(fromCh?.guild_id))
    vcJoinTime[uid] = Date.now()

    const route = `#${fromName} → #${toName}`
    notify({
        _uid: uid,
        title: `${dn} Moved Voice Channels`,
        body: gName ? `${gName}: ${route}` : route,
        icon,
        onClick: () => jumpTo(toCh?.guild_id, to),
    })

    // the move card doubles as the session card for the new channel
    const server = gName || "DM"
    const platform = platformOf(uid)
    await openSession(uid, sessionKey(uid, "voice", to), "🎙️", "moved voice channels", `${gName ? gName + " · " : ""}${route}`, {
        guildId: toCh?.guild_id,
        channelId: to,
        logMeta: { server, fromChannel: fromName, toChannel: toName, action: "moved" },
        sessMeta: { server, channel: toName, platform, fromChannel: fromName, toChannel: toName },
    })
}

async function handleVoiceState(vs: VoiceState) {
    const uid = vs.userId
    if (!isWatched(settings, uid)) return

    const old = vcCache[uid]
    const now = vs.channelId || null

    if (old === undefined) {
        vcCache[uid] = now
        cameraCache[uid] = vs.selfVideo ?? false
        streamCache[uid] = vs.selfStream ?? false
        return
    }
    vcCache[uid] = now

    if (!isFeatureOn(uid, "voice", "globalVoice")) {
        cameraCache[uid] = vs.selfVideo ?? false
        streamCache[uid] = vs.selfStream ?? false
        return
    }

    const u = UserStore.getUser(uid)
    const dn = labeledName(uid, u)
    const icon = u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined

    if (!old && now) await joinVoice(uid, now, dn, icon)
    else if (old && !now) await leaveVoice(uid, old, dn, icon)
    else if (old && now && old !== now) await moveVoice(uid, old, now, dn, icon)

    // discord sends a separate event when selfVideo/selfStream flips
    if (now) {
        await toggleMedia(uid, "camera", vs.selfVideo ?? false, dn, icon, now)
        await toggleMedia(uid, "stream", vs.selfStream ?? false, dn, icon, now)
    }
}

export async function onVoiceStateUpdates({ voiceStates }: VoiceStateEvent) {
    for (const vs of voiceStates || []) {
        try {
            await handleVoiceState(vs)
        } catch (e) { log.error("voice update failed for", vs.userId, e) }
    }
}
