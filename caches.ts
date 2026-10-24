import { findByProps } from "@webpack"

import { unpin } from "./pins"
import { activeSessions, scheduleSessionSave } from "./sessions"
import { log } from "./store"
import { resolveClient } from "./utils"

export const profileCache:  Record<string, any>                          = {}
export const vcCache:       Record<string, string | null>                = {}
export const statusCache:   Record<string, string>                       = {}
export const activityCache: Record<string, string[]>                     = {}
export const guildCache:    Record<string, Set<string>>                  = {}
export const vcJoinTime:    Record<string, number>                       = {}
export const clientCache:   Record<string, string | null>                = {}
export const cameraCache:   Record<string, boolean>                      = {}
export const streamCache:   Record<string, boolean>                      = {}
export const customStatusCache: Record<string, string | null>            = {}  // text status (activity type 4)
export const statusSessionCache: Record<string, { startTime: number; startStatus: string; changes: { status: string; ts: number }[]; platforms: { platform: string; ts: number }[] } | null> = {}  // status session tracking

// pending "is typing" log per user+channel — MESSAGE_CREATE deletes it if they actually send.
// stays if they don't.
export const pendingTypingLog: Record<string, { logId: string; ts: number }> = {}


export const _notifDebounce: Record<string, number> = {}
export const _logDebounce: Record<string, number> = {}
export const presenceDebounce = new Map<string, ReturnType<typeof setTimeout>>()

// one key per activity, spotify keeps the track so song changes count as a new activity
export function actKey(a: any): string {
    return a.type === 2
        ? `2\x00${a.name}\x00${a.details || ""}\x00${a.state || ""}`
        : `${a.type}\x00${a.name}`
}

export function customStatusText(act: any): string | null {
    return act ? [act.emoji?.name, act.state].filter(Boolean).join(" ") || null : null
}

// snapshot of what discord already knows, so the first live event is not mistaken for a change
export function seedUserCaches(uid: string) {
    try {
        const vs = findByProps("getVoiceStateForUser")?.getVoiceStateForUser?.(uid)
        vcCache[uid]     = vs?.channelId ?? null
        cameraCache[uid] = vs?.selfVideo ?? false
        streamCache[uid] = vs?.selfStream ?? false
    } catch { vcCache[uid] = null; cameraCache[uid] = false; streamCache[uid] = false }

    try {
        const presMod = findByProps("getStatus", "getActivities")
        const cs = presMod?.getClientStatus?.(uid)
        clientCache[uid] = cs ? resolveClient(cs) : null

        const status = presMod?.getStatus?.(uid)
        if (status) statusCache[uid] = status
        const acts: any[] = presMod?.getActivities?.(uid) ?? []
        activityCache[uid] = acts.filter(a => a.type !== 4).map(actKey)
        customStatusCache[uid] = customStatusText(acts.find(a => a.type === 4))
    } catch (e) { log.warn("could not seed caches for", uid, e) }
}

// wipes all per-user caches when someone is removed from the watchlist,
// otherwise re-adding compares against a stale baseline
export function purgeUserCaches(uid: string) {
    delete profileCache[uid]
    delete vcCache[uid]
    delete statusCache[uid]
    delete activityCache[uid]
    delete guildCache[uid]
    delete vcJoinTime[uid]
    delete clientCache[uid]
    delete cameraCache[uid]
    delete streamCache[uid]
    delete customStatusCache[uid]
    delete statusSessionCache[uid]

    // sessionKey always prefixes with "uid_", safe to match on that
    for (const k of Object.keys(activeSessions)) {
        if (k === uid || k.startsWith(`${uid}_`)) delete activeSessions[k]
    }
    scheduleSessionSave()

    for (const k of Object.keys(pendingTypingLog)) if (k.startsWith(`${uid}_`)) delete pendingTypingLog[k]
    for (const k of Object.keys(_notifDebounce)) if (k.startsWith(`${uid}\x00`)) delete _notifDebounce[k]
    for (const k of Object.keys(_logDebounce)) if (k.includes(uid)) delete _logDebounce[k]

    const timer = presenceDebounce.get(uid)
    if (timer) { clearTimeout(timer); presenceDebounce.delete(uid) }
    unpin(uid)
}

export function resetCaches() {
    for (const c of [profileCache, vcCache, statusCache, activityCache, guildCache, vcJoinTime, clientCache, cameraCache,
        streamCache, customStatusCache, statusSessionCache, activeSessions, pendingTypingLog, _notifDebounce, _logDebounce] as Record<string, unknown>[]) {
        for (const k of Object.keys(c)) delete c[k]
    }
    presenceDebounce.forEach(t => clearTimeout(t))
    presenceDebounce.clear()
}
