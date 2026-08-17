// UserRadar — k1ng_op
// tracks msgs, edits, deletes, typing, profile/pfp, voice, status, activity, joins

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu"
import { DataStore, Notifications } from "@api/index"
import { definePluginSettings } from "@api/Settings"
import { getCurrentChannel, openUserProfile } from "@utils/discord"
import definePlugin, { OptionType } from "@utils/types"
import { findByProps } from "@webpack"
import { ChannelStore, Menu, MessageStore, Modal, openModal, React, RestAPI, Toasts, UserStore } from "@webpack/common"
import type { JSX } from "react"

import {
    addUser, camelize, displayName, featureOn,
    getWatchedUser, getWatchlist, inQuietHours,
    isWatched, log, patchUser, removeUser
} from "./store"

import {
    GuildMemberEvent, MsgCreateEvent, MsgDeleteEvent, MsgUpdateEvent,
    PresenceEvent,
    TypingEvent, VoiceStateEvent, WatchedUser
} from "./types"

const STATUS_EMOJI_LOCAL: Record<string, string> = {
    online: "🟢",
    idle: "🌙",
    dnd: "🔴",
    offline: "⚫",
    invisible: "⚫",
}
const ACTIVITY_LOG_KEY = "UserRadar_ActivityLog_v2"
export type ActivityType =
    | "msg" | "edit" | "delete" | "typing"
    | "status" | "activity" | "voice"
    | "join" | "leave" | "boost"
    | "profile" | "avatar" | "banner" | "bio" | "username" | "displayname"
    | "pronouns" | "custom_status"
    | "online" | "offline" | "idle" | "dnd"
    | "game_start" | "game_stop" | "spotify" | "streaming"
    | "vc_join" | "vc_leave" | "vc_move"
    | "session"

export interface ActivityEntry {
    id: string
    uid: string
    ts: number
    type: ActivityType
    icon: string
    title: string
    body: string
    guildId?: string
    channelId?: string
    msgId?: string
    metadata?: Record<string, any>
}

function sessionKey(uid: string, type: string, channelId?: string): string {
    return channelId ? `${uid}_${type}_${channelId}` : `${uid}_${type}`
}

class ActivityStore {
    private cache: Record<string, ActivityEntry[]> = {}
    private loaded = false
    private loadPromise: Promise<void> | null = null

    async load() {
        if (this.loaded) return
        if (this.loadPromise) return this.loadPromise
        this.loadPromise = (async () => {
            try {
                const data = await DataStore.get(ACTIVITY_LOG_KEY)
                if (data) this.cache = JSON.parse(data)
            } catch (e) { console.error("[UserRadar] Failed to load activity log", e) }
            this.loaded = true
        })()
        return this.loadPromise
    }

    async save() {
        try {
            await DataStore.set(ACTIVITY_LOG_KEY, JSON.stringify(this.cache))
        } catch (e) { console.error("[UserRadar] Failed to save activity log", e) }
    }

    // batches rapid writes into one save
    private saveTimer: ReturnType<typeof setTimeout> | null = null
    private pendingSave: { resolve: () => void }[] = []
    private scheduleSave(): Promise<void> {
        return new Promise(resolve => {
            this.pendingSave.push({ resolve })
            if (this.saveTimer) return
            this.saveTimer = setTimeout(async () => {
                this.saveTimer = null
                const waiters = this.pendingSave
                this.pendingSave = []
                await this.save()
                waiters.forEach(w => w.resolve())
            }, 1500)
        })
    }
    // forces the pending debounced save through immediately
    async flushSave() {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
        const waiters = this.pendingSave
        this.pendingSave = []
        await this.save()
        waiters.forEach(w => w.resolve())
    }

    getLogs(uid: string): ActivityEntry[] {
        return this.cache[uid] || []
    }

    // serializes writes so addLog/removeLog/updateLog never interleave
    private writeQueue: Promise<any> = Promise.resolve()
    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(fn, fn)
        this.writeQueue = next.catch(() => {})
        return next
    }

    async addLog(entry: Omit<ActivityEntry, "id">) {
        return this.enqueue(async () => {
            await this.load()
            if (!this.cache[entry.uid]) this.cache[entry.uid] = []
            const fullEntry: ActivityEntry = {
                ...entry,
                id: `${entry.uid}_${entry.ts}_${Math.random().toString(36).slice(2, 8)}`,
            }
            this.cache[entry.uid].unshift(fullEntry)
            const rawMax = settings.store.maxLogsPerUser
            const max = rawMax < 0 ? 0 : Math.min(rawMax, 50000)
            if (max > 0 && this.cache[entry.uid].length > max)
                this.cache[entry.uid].length = max
            await this.scheduleSave()
            return fullEntry
        })
    }

    async clearLogs(uid: string) {
        return this.enqueue(async () => {
            await this.load()
            delete this.cache[uid]
            await this.save()
        })
    }

    async clearAll() {
        return this.enqueue(async () => {
            this.cache = {}
            await DataStore.del(ACTIVITY_LOG_KEY)
        })
    }

    exportAll(): string {
        return JSON.stringify(this.cache, null, 2)
    }

    async importAll(json: string) {
        return this.enqueue(async () => {
            try {
                const parsed = JSON.parse(json)
                // Validate it's a plain object whose values are arrays of entries
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false
                for (const [uid, entries] of Object.entries(parsed)) {
                    if (typeof uid !== "string") return false
                    if (!Array.isArray(entries)) return false
                    for (const e of entries as any[]) {
                        if (typeof e !== "object" || e === null) return false
                        if (typeof e.id !== "string" || typeof e.uid !== "string" || typeof e.ts !== "number") return false
                    }
                }
                await this.load()
                // merge by id, don't replace whole cache — category export would wipe everything
                for (const [uid, entries] of Object.entries(parsed as Record<string, ActivityEntry[]>)) {
                    if (!this.cache[uid]) this.cache[uid] = []
                    const existingIds = new Set(this.cache[uid].map(e => e.id))
                    for (const e of entries) {
                        if (!existingIds.has(e.id)) this.cache[uid].push(e)
                    }
                    this.cache[uid].sort((a, b) => b.ts - a.ts)
                }
                await this.save()
                return true
            } catch { return false }
        })
    }

    async updateLog(uid: string, logId: string, updates: Partial<ActivityEntry>) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return false
            const idx = logs.findIndex(l => l.id === logId)
            if (idx === -1) return false
            const updated = { ...logs[idx], ...updates, ts: Date.now() }
            logs.splice(idx, 1)
            logs.unshift(updated)
            await this.save()
            emitActivityUpdate(uid, updated)
            return true
        })
    }

    async removeLog(uid: string, logId: string) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return false
            this.cache[uid] = logs.filter(l => l.id !== logId)
            await this.save()
            emitActivityRemove(uid, logId)
            return true
        })
    }

    // bulk delete — e.g. "remove all typing cards" / "remove all status cards" for a user
    async removeLogsWhere(uid: string, predicate: (log: ActivityEntry) => boolean): Promise<number> {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return 0
            const toRemove = logs.filter(predicate)
            if (toRemove.length === 0) return 0
            this.cache[uid] = logs.filter(l => !predicate(l))
            await this.save()
            toRemove.forEach(l => emitActivityRemove(uid, l.id))
            return toRemove.length
        })
    }
}

export const activityStore = new ActivityStore()

const activityListeners = new Set<(uid: string, entry: ActivityEntry) => void>()

export function onActivityUpdate(cb: (uid: string, entry: ActivityEntry) => void) {
    activityListeners.add(cb)
    return () => activityListeners.delete(cb)
}

function emitActivityUpdate(uid: string, entry: ActivityEntry) {
    activityListeners.forEach(cb => cb(uid, entry))
}

const activityRemoveListeners = new Set<(uid: string, logId: string) => void>()

export function onActivityRemove(cb: (uid: string, logId: string) => void) {
    activityRemoveListeners.add(cb)
    return () => activityRemoveListeners.delete(cb)
}

function emitActivityRemove(uid: string, logId: string) {
    activityRemoveListeners.forEach(cb => cb(uid, logId))
}

export async function logUserActivity(
    uid: string,
    type: ActivityType,
    icon: string,
    title: string,
    body: string,
    options?: {
        guildId?: string
        channelId?: string
        msgId?: string
        metadata?: Record<string, any>
    }
) {
    const entry = await activityStore.addLog({
        uid, ts: Date.now(), type, icon, title, body, ...options,
    })
    emitActivityUpdate(uid, entry)
    return entry
}

function logActivity(uid: string, type: string, icon: string, title: string, body?: string, guildId?: string, channelId?: string, msgId?: string) {
    logUserActivity(uid, type as ActivityType, icon, title, body ?? title, { guildId, channelId, msgId }).catch(() => {})
}

const profileCache:  Record<string, any>                          = {}
const vcCache:       Record<string, string | null>                = {}
const statusCache:   Record<string, string>                       = {}
const activityCache: Record<string, string[]>                     = {}
const guildCache:    Record<string, Set<string>>                  = {}
const vcJoinTime:    Record<string, number>                       = {}
const clientCache:   Record<string, string | null>                = {}
const cameraCache:   Record<string, boolean>                      = {}
const streamCache:   Record<string, boolean>                      = {}
const customStatusCache: Record<string, string | null>            = {}  // text status (activity type 4)
const statusSessionCache: Record<string, { startTime: number; startStatus: string; changes: { status: string; ts: number }[]; platforms: { platform: string; ts: number }[] } | null> = {}  // status session tracking

const activeSessions: Record<string, { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }> = {}

// pending "is typing" log per user+channel — MESSAGE_CREATE deletes it if they actually send.
// stays if they don't.
const pendingTypingLog: Record<string, { logId: string; ts: number }> = {}
const TYPING_LOG_TTL_MS = 3 * 60 * 1000

// persisted so a discord restart doesn't orphan whatever was mid-session
const ACTIVE_SESSIONS_KEY = "UserRadar_ActiveSessions_v1"

async function saveActiveSessions() {
    try { await DataStore.set(ACTIVE_SESSIONS_KEY, JSON.stringify(activeSessions)) }
    catch (e) { log.warn("[UserRadar] failed to save active sessions", e) }
}

async function loadActiveSessions(): Promise<Record<string, { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }>> {
    try {
        const data = await DataStore.get(ACTIVE_SESSIONS_KEY)
        return data ? JSON.parse(data) : {}
    } catch { return {} }
}

let _sessSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSessionSave() {
    if (_sessSaveTimer) return
    _sessSaveTimer = setTimeout(() => { _sessSaveTimer = null; saveActiveSessions() }, 1000)
}
let _sessSaveInterval: ReturnType<typeof setInterval> | null = null

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000  // 24h — a session stuck this long means the close event never arrived (client crash, force quit, etc)

async function sweepStaleSessions() {
    const now = Date.now()
    let touched = false
    for (const [sk, sess] of Object.entries(activeSessions)) {
        if (now - sess.startTime < MAX_SESSION_AGE_MS) continue
        delete activeSessions[sk]
        touched = true
        try {
            await activityStore.updateLog(sk.split("_")[0], sess.logId, {
                title: sess.metadata?.channel ? `Was in #${sess.metadata.channel}` : "Session ended",
                body: "session ended unexpectedly (no close event received)",
                metadata: { ...sess.metadata, duration: formatDuration(now - sess.startTime), startTime: sess.startTime, endTime: now },
            })
        } catch { }
    }
    if (touched) scheduleSessionSave()
}

let pluginStartedAt = 0

let pollTimer:  ReturnType<typeof setInterval> | null = null
let pluginActive = false

function tryLoadLoggedMsgs() {
    try {
        const plugin = (Vencord as any)?.Plugins?.plugins?.["vc-message-logger-enhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["MessageLoggerEnhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["messageLoggerEnhanced"]
        if (plugin?.loggedMessages) return plugin.loggedMessages
        if (plugin?.store?.loggedMessages) return plugin.store.loggedMessages
    } catch { }

    try {
        const { wreq } = (window as any).webpackChunkdiscord_app?.find?.(
            (x: any) => x?.[1]?.["loggedMessages"]
        )?.[1] ?? {}
        if (wreq?.["loggedMessages"]) return wreq["loggedMessages"]
    } catch { }

    return null
}

const settings = definePluginSettings({
    watchlist:          { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "watchlist json — managed by the ui, don't touch" },
    globalPresetMode:   { type: OptionType.STRING,  hidden: true,  default: "custom",               description: "global preset mode" },
    installedSha:       { type: OptionType.STRING,  hidden: true,  default: "none",  description: "installed commit sha" },
    globalMsgs:         { type: OptionType.BOOLEAN, default: true,                   description: "messages" },
    globalEdits:        { type: OptionType.BOOLEAN, default: true,                   description: "edits" },
    globalDeletes:      { type: OptionType.BOOLEAN, default: true,                   description: "deletes (needs msg-logger-enhanced)" },
    globalTyping:       { type: OptionType.BOOLEAN, default: true,                   description: "typing" },
    globalProfile:      { type: OptionType.BOOLEAN, default: true,                   description: "profile changes" },
    globalAvatar:       { type: OptionType.BOOLEAN, default: true,                   description: "avatar changes" },
    globalVoice:        { type: OptionType.BOOLEAN, default: true,                   description: "voice" },
    globalStatus:       { type: OptionType.BOOLEAN, default: false,                  description: "status (spammy)" },
    globalActivity:     { type: OptionType.BOOLEAN, default: false,                  description: "activity changes (spammy)" },
    globalJoins:        { type: OptionType.BOOLEAN, default: true,                   description: "server joins/leaves" },
    showPreview:        { type: OptionType.BOOLEAN, default: true,                   description: "show message preview" },
    previewLen:         { type: OptionType.NUMBER,  default: 120,                  description: "preview length (0 = unlimited)" },
    quietHours:         { type: OptionType.BOOLEAN, default: false,                  description: "quiet hours" },
    quietStart:         { type: OptionType.STRING,  default: "23:00",                description: "quiet hours start (24h, e.g. 23:00)" },
    quietEnd:           { type: OptionType.STRING,  default: "07:00",                description: "quiet hours end (24h, e.g. 07:00)" },
    skipCurrentChannel: { type: OptionType.BOOLEAN, default: true,                   description: "skip if already in that channel" },
    maxLogsPerUser:     { type: OptionType.NUMBER,  default: 500,                    description: "max logs per user (0 = unlimited)" },
    pinnedUsers:        { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "pinned watchlist user ids" },
    compactLogView:     { type: OptionType.BOOLEAN, default: false,                  description: "compact activity log cards" },
    autoCleanupLogs:    { type: OptionType.BOOLEAN, default: true,                   description: "delete logs when removing a user from watchlist" },
    debugLog:           { type: OptionType.BOOLEAN, default: false,                  description: "debug logging" },
    showToolbarIcon:    { type: OptionType.BOOLEAN, default: true,                   description: "toolbar icon" },
    logVcMembers:       { type: OptionType.BOOLEAN, default: false,                  description: "also log names of other people in the voice channel (privacy: logs non-watched users too)" },
})

function trunc(s: string, max: number) {
    return max > 0 && s.length > max ? s.slice(0, max) + "…" : s
}

function msgPreview(content: string, filename?: string) {
    if (!settings.store.showPreview) return "click to jump"
    return trunc(content || filename || "click to jump", settings.store.previewLen)
}

function jumpTo(guildId?: string, channelId?: string, msgId?: string) {
    if (guildId)   findByProps("transitionToGuildSync")?.transitionToGuildSync(guildId)
    if (channelId) findByProps("selectChannel")?.selectChannel({ guildId: guildId ?? "@me", channelId, messageId: msgId })
}

// wipes all per-user caches when someone is removed from the watchlist —
// otherwise re-adding compares against a stale baseline
function purgeUserCaches(uid: string) {
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
    for (const k of Object.keys(_logDebounce)) {
        if (k.includes(uid)) delete _logDebounce[k]
    }
}

function getPinned(): string[] {
    try { return JSON.parse(settings.store.pinnedUsers || "[]") } catch { return [] }
}
function togglePin(uid: string) {
    const cur = getPinned()
    const next = cur.includes(uid) ? cur.filter(id => id !== uid) : [...cur, uid]
    settings.store.pinnedUsers = JSON.stringify(next)
}

function isFeatureOn(uid: string, userKey: keyof WatchedUser["overrides"], globalKey: string): boolean {
    if (!isWatched(settings, uid)) return false
    const mode = settings.store.globalPresetMode ?? "custom"
    if (mode !== "custom") {
        if (mode === "silent") return false
        if (mode === "stalker") return true
        if (mode === "lite") {
            const liteFeatures = ["msgs", "deletes", "typing", "avatar", "voice", "status"]
            return liteFeatures.includes(userKey as string)
        }
    }
    return featureOn(settings, uid, userKey, globalKey)
}

const _notifDebounce: Record<string, number> = {}
const _logDebounce: Record<string, number> = {}
const presenceDebounce = new Map<string, ReturnType<typeof setTimeout>>()

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Away", dnd: "Do Not Disturb", offline: "Offline", invisible: "Invisible" }
const ACT_VERB: Record<number, string> = { 0: "playing", 2: "listening to", 3: "watching", 5: "competing in" }
const isOfflineStatus = (s: string) => s === "offline" || s === "invisible"

function notify(opts: { title: string; body: string; icon?: string; onClick?: () => void; _uid?: string }) {
    if (inQuietHours(settings)) return
    if (settings.store.globalPresetMode === "silent") return

    // title already has the name baked in, unique per user
    const key = `${opts._uid ?? opts.title}\x00${opts.title}\x00${opts.body}`
    const now = Date.now()
    if (_notifDebounce[key] && now - _notifDebounce[key] < 1500) return
    _notifDebounce[key] = now

    // sweep stale entries so this doesn't grow forever over a long session
    if (Object.keys(_notifDebounce).length > 500) {
        for (const k of Object.keys(_notifDebounce)) {
            if (now - _notifDebounce[k] > 60000) delete _notifDebounce[k]
        }
    }

    if (settings.store.debugLog) log.info(`[notif] ${opts.title} — ${opts.body}`)
    Notifications.showNotification({ title: opts.title, body: opts.body, icon: opts.icon, onClick: opts.onClick })
}

function avatarUrl(id: string, hash?: string | null, size = 80): string {
    try {
        if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=${size}`
        let i = 0
        try { i = Number((BigInt(id) >> 22n) % 6n) } catch { i = parseInt(id.slice(-4), 10) % 6 || 0 }
        return `https://cdn.discordapp.com/embed/avatars/${i}.png`
    } catch { return "https://cdn.discordapp.com/embed/avatars/0.png" }
}

function guildName(guildId?: string | null): string | null {
    if (!guildId) return null
    return findByProps("getGuild")?.getGuild(guildId)?.name ?? null
}

const FALLBACK_AV = "https://cdn.discordapp.com/embed/avatars/0.png"

const PROFILE_TEXT = ["username", "globalName", "bio", "banner", "pronouns"] as const
const FIELD_NAME: Record<string, string> = {
    username: "username", globalName: "display name",
    bio: "about me", banner: "banner", pronouns: "pronouns",
}
const PROFILE_TYPE_MAP: Record<string, ActivityType> = {
    username: "username",
    globalName: "displayname",
    bio: "bio",
    banner: "banner",
    pronouns: "pronouns",
}
const PROFILE_ICON_MAP: Record<string, string> = {
    username: "🏷️",
    globalName: "📛",
    bio: "📝",
    banner: "🏳️",
    pronouns: "🪪",
}

function checkProfileChanged(uid: string, fresh: any) {
    if (!isWatched(settings, uid)) return
    const old = profileCache[uid]
    if (!old) {
        profileCache[uid] = fresh
        return
    }

    // avatar — separate feature flag
    const oldAvatar = old.user?.avatar ?? old.user?.avatarUrl ?? null
    const newAvatar = fresh.user?.avatar ?? fresh.user?.avatarUrl ?? null
    if (newAvatar !== oldAvatar) {
        if (isFeatureOn(uid, "avatar", "globalAvatar")) {
            const name  = displayName(fresh.user)
            const label = getWatchedUser(settings, uid)?.nick
            const dn    = label ? `${label} (${name})` : name
            const oldAvatarUrl = oldAvatar ? avatarUrl(uid, oldAvatar, 256) : null
            const newAvatarUrl = newAvatar ? avatarUrl(uid, newAvatar, 256) : null
            notify({
                _uid: uid,
                title: newAvatar ? `${dn} changed their avatar` : `${dn} removed their avatar`,
                body: newAvatar ? "click to see new pfp" : "reset to default",
                icon: newAvatarUrl ?? undefined,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, "avatar", "🖼️",
                newAvatar ? `changed their avatar` : `removed their avatar`,
                "",
                { metadata: { oldAvatar: oldAvatarUrl, newAvatar: newAvatarUrl } }
            ).catch(() => {})
        }
    }

    // text profile fields — one log per changed field
    if (isFeatureOn(uid, "profile", "globalProfile")) {
        const u     = UserStore.getUser(uid)
        const name  = displayName(fresh.user)
        const label = getWatchedUser(settings, uid)?.nick
        const dn    = label ? `${label} (${name})` : name
        const icon  = u ? avatarUrl(u.id, (u as any).avatar) : undefined

        for (const f of PROFILE_TEXT) {
            // pronouns sits at root, not under user
            const rawOld = f === "pronouns"
                ? (old.pronouns ?? old.user?.pronouns ?? null)
                : (old.user?.[f] ?? null)
            const rawNew = f === "pronouns"
                ? (fresh.pronouns ?? fresh.user?.pronouns ?? null)
                : (fresh.user?.[f] ?? null)
            const oldVal = rawOld === "" ? null : rawOld
            const newVal = rawNew === "" ? null : rawNew
            if (oldVal === newVal) continue

            const fieldLabel = FIELD_NAME[f] ?? f
            const actType    = PROFILE_TYPE_MAP[f] ?? "profile"
            const actIcon    = PROFILE_ICON_MAP[f] ?? "👤"

            const notifyBody = newVal
                ? (oldVal ? `${oldVal} → ${newVal}` : newVal)
                : `removed ${fieldLabel}`

            notify({
                _uid: uid,
                title: `${dn} changed their ${fieldLabel}`,
                body: notifyBody,
                icon,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, actType, actIcon,
                `changed their ${fieldLabel}`,
                "",  // shown via diff card instead
                { metadata: { field: f, before: oldVal, after: newVal } }
            ).catch(() => {})
        }
    }

    profileCache[uid] = fresh
}

let _pollRunning = false
// fetches profile/status/activity right away for one freshly-added user instead
// of waiting for the next 5-minute poll cycle to reach them
async function fetchNewUserBaseline(uid: string) {
    if (!pluginActive) return
    try {
        const presMod = findByProps("getStatus", "getActivities")
        const status = presMod?.getStatus?.(uid)
        if (status) statusCache[uid] = status
        const acts: any[] = presMod?.getActivities?.(uid) ?? []
        // must match actKeyOf()'s shape exactly (array of keys) — PRESENCE_UPDATES does
        // `oldActKeys.includes(k)` and `for (const k of oldActKeys)` on this cache. a bare
        // string here gets iterated char-by-char and substring-matched instead of key-matched,
        // which fires garbage "stopped playing" notifs on the very next real presence tick.
        const realActs = acts.filter((a: any) => a.type !== 4)
        activityCache[uid] = realActs.map((a: any) => a.type === 2
            ? `2\x00${a.name}\x00${a.details || ""}\x00${a.state || ""}`
            : `${a.type}\x00${a.name}`)
        const customAct = acts.find((a: any) => a.type === 4) ?? null
        customStatusCache[uid] = customAct
            ? [customAct.emoji?.name, customAct.state].filter(Boolean).join(" ") || null
            : null
        guildCache[uid] = new Set()

        const { body } = await RestAPI.get({
            url: `/users/${uid}/profile`,
            query: { with_mutual_guilds: true, with_mutual_friends_count: false },
        })
        const data = camelize(body)
        profileCache[uid] = data
        if (Array.isArray(data.mutualGuilds)) {
            guildCache[uid] = new Set(data.mutualGuilds.map((g: any) => g.id))
        }
    } catch { }
}

async function pollProfiles() {
    if (_pollRunning || !pluginActive) return
    _pollRunning = true
    const list = getWatchlist(settings)
    try {
        await sweepStaleSessions()
        for (const wu of list) {
            if (!pluginActive) break
            try {
                const { body } = await RestAPI.get({
                    url: `/users/${wu.id}/profile`,
                    query: { with_mutual_guilds: false, with_mutual_friends_count: false },
                })
                checkProfileChanged(wu.id, camelize(body))
            } catch { }
            await new Promise(r => setTimeout(r, 1500))
        }
    } finally {
        _pollRunning = false
    }
}

const STYLE_ID = "ur-s9"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = `
        @keyframes ur-spin { to { transform:rotate(360deg) } }
        .ur-spin { display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2.5px solid #3f4147;border-top-color:#dbdee1;
            animation:ur-spin .55s linear infinite;vertical-align:middle; }
        @keyframes ur-fade-in { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
        .ur-fade-in { animation:ur-fade-in .2s cubic-bezier(.4,0,.2,1) forwards; }
        .ur-expand { display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s cubic-bezier(.4,0,.2,1); }
        .ur-expand.open { grid-template-rows:1fr; }
        .ur-expand > div { overflow:hidden; }
        .ur-row-hover:hover { background:rgba(255,255,255,0.06); }

        @keyframes ur-row-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-row { animation: ur-row-in .28s cubic-bezier(.2,.9,.3,1.2) both; transition: transform .2s cubic-bezier(.2,.8,.2,1.1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-row:hover { transform: translateY(-3px) scale(1.008); box-shadow: 0 14px 30px rgba(0,0,0,0.38); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-row:active { transform: translateY(-1px) scale(.995); }
        .ur-row.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-row-avatar { transition: transform .2s cubic-bezier(.2,.8,.2,1.4); }
        .ur-row:hover .ur-row-avatar { transform: scale(1.08); }

        .ur-row-pin { transition: opacity .12s ease, color .12s ease, transform .22s cubic-bezier(.34,1.56,.64,1); }
        .ur-row:hover .ur-row-pin { transform: scale(1.12); }

        .ur-row-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-row:hover .ur-row-chevron { opacity:1; transform: scale(1.15); }
        .ur-row-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }
        .ur-row:hover .ur-row-chevron.open { transform: rotate(180deg) scale(1.15); }

        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; transition: transform .18s cubic-bezier(.2,.8,.2,1.3); }
        .ur-row:hover .ur-badge-in { transform: scale(1.07); }

        .ur-activity-btn { transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .22s ease; backdrop-filter: blur(8px) saturate(160%); -webkit-backdrop-filter: blur(8px) saturate(160%); }
        .ur-activity-btn:hover { transform: translateY(-2px) scale(1.06); background: rgba(88,101,242,0.18) !important; border-color: rgba(88,101,242,0.5) !important; box-shadow: 0 6px 16px rgba(88,101,242,0.28); }
        .ur-activity-btn:active { transform: translateY(0) scale(.95); }

        @keyframes ur-pin-pop { 0% { transform:scale(.6) rotate(-20deg); } 60% { transform:scale(1.25) rotate(6deg); } 100% { transform:scale(1) rotate(0); } }
        .ur-pin-pop { animation: ur-pin-pop .38s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-chip { transition: transform .12s cubic-bezier(.2,.8,.2,1), background .18s ease, color .18s ease; }
        .ur-chip:active { transform: scale(.94); }

        @keyframes ur-badge-in { from { opacity:0; transform:scale(.5); } to { opacity:1; transform:scale(1); } }
        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-icon-btn { transition: transform .14s cubic-bezier(.2,.8,.2,1.3), background .14s ease, color .14s ease; }
        .ur-icon-btn:hover { transform: translateY(-1px) scale(1.08); }
        .ur-icon-btn:active { transform: scale(.9); }

        @keyframes ur-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .ur-float { animation: ur-float 3s ease-in-out infinite; }

        /* Discord-style thin scrollbar - only visible on hover */
        .ur-scrollbar::-webkit-scrollbar { width:4px; height:4px; }
        .ur-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .ur-scrollbar::-webkit-scrollbar-thumb { background:transparent; border-radius:4px; }
        .ur-scrollbar:hover::-webkit-scrollbar-thumb { background:#3f4147; }
        .ur-scrollbar::-webkit-scrollbar-thumb:hover { background:#4a4a6e; }

        /* Firefox scrollbar */
        .ur-scrollbar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .ur-scrollbar:hover { scrollbar-color: #3f4147 transparent; }

        .ur-typing-dot { animation: ur-typing 1.4s infinite ease-in-out both; }
        .ur-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ur-typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes ur-typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        @keyframes ur-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); } 20%, 40%, 60%, 80% { transform: translateX(4px); } }
        .ur-shake { animation: ur-shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes ur-pulse { 0% { box-shadow: 0 0 0 0 #5865f2; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        .ur-pulse { animation: ur-pulse 2s infinite; }
        @keyframes ur-flash-green { 0% { background: #248046; } 100% { background: #5865f2; } }
        .ur-flash-green { animation: ur-flash-green 0.5s ease; }
        @keyframes ur-blink-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.7); } }
        .ur-blink-dot { animation: ur-blink-dot 1.4s ease-in-out infinite; }

        .ur-compact [data-ur-card-body] { padding: 6px 10px !important; gap: 8px !important; margin-bottom: 3px !important; min-height: 0 !important; border-radius: 10px !important; }
        .ur-compact [data-ur-card-icon] { width: 22px !important; height: 22px !important; border-radius: 6px !important; font-size: 12px !important; margin-top: 0 !important; }
        .ur-compact [data-ur-card-icon] img { width: 14px !important; height: 14px !important; }
        .ur-compact [data-ur-card-title] { font-size: 12px !important; margin-bottom: 0 !important; gap: 5px !important; }
        .ur-compact [data-ur-card-body-text="meta"] { display: none !important; }
        .ur-compact [data-ur-card-body-text="content"] { font-size: 11px !important; margin-top: 0 !important; -webkit-line-clamp: 1; display: -webkit-box !important; -webkit-box-orient: vertical; overflow: hidden; }
        .ur-compact [data-ur-card-location] { display: none !important; }
        .ur-compact [data-ur-card-live] { padding: 1px 5px !important; font-size: 8px !important; margin-bottom: 0 !important; }
        .ur-compact { gap: 4px !important; }
        .ur-compact [data-ur-day-header] { margin-bottom: 3px !important; }

        /* Activity log modal specific - prevent horizontal scroll */
        .ur-activity-modal { overflow-x: hidden !important; }
        .ur-activity-modal * { max-width: 100%; box-sizing: border-box; }

        /* glassmorphism helpers */
        .ur-glass { backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); }
        .ur-badge-glass { backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }

        .ur-tab-btn { transition: transform 160ms cubic-bezier(.34,1.56,.64,1), background 200ms ease, color 200ms ease, box-shadow 200ms ease; }
        .ur-tab-btn:hover { transform: translateY(-1px) scale(1.03); }
        .ur-tab-btn:active { transform: scale(.95); }

        .ur-preset-card { transition: transform 200ms cubic-bezier(.34,1.56,.64,1), background 220ms ease, border-color 220ms ease, box-shadow 220ms ease; }
        .ur-preset-card:hover { transform: translateY(-2px) scale(1.015); }
        .ur-preset-card:active { transform: translateY(0) scale(.985); }

        @keyframes ur-modal-in { from { opacity:0; transform:scale(.97) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .ur-modal-in { animation: ur-modal-in .28s cubic-bezier(.2,.9,.3,1.1) both; }

        @keyframes ur-status-pop { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:scale(1); } }
        .ur-status-dot { animation: ur-status-pop .3s cubic-bezier(.34,1.56,.64,1) both; transition: background 200ms ease, box-shadow 200ms ease; }

        .ur-card-hover { transition: transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, border-color 180ms ease, background 180ms ease; }
        .ur-card-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }

        @keyframes ur-log-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-log-card { animation: ur-log-in .26s cubic-bezier(.2,.9,.3,1.15) both; transition: transform .2s cubic-bezier(.2,.8,.2,1.1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-log-card:hover { transform: translateY(-3px) scale(1.008); box-shadow: 0 14px 30px rgba(0,0,0,0.38); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-log-card:active { transform: translateY(-1px) scale(.995); }
        .ur-log-card.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-log-icon { transition: transform .22s cubic-bezier(.2,.8,.2,1.4), box-shadow .22s ease; }
        .ur-log-card:hover .ur-log-icon { transform: scale(1.08) rotate(-4deg); }

        .ur-log-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-log-card:hover .ur-log-chevron { opacity:1; }
        .ur-log-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }

        .ur-log-expand-in { animation: ur-fade-in .22s cubic-bezier(.4,0,.2,1) both; }

        .ur-footer-btn { transition: transform .2s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .2s ease, color .18s ease; backdrop-filter: blur(10px) saturate(160%); -webkit-backdrop-filter: blur(10px) saturate(160%); }
        .ur-footer-btn:hover { transform: translateY(-2px) scale(1.04); background: rgba(255,255,255,0.09) !important; border-color: #3f4147 !important; box-shadow: 0 6px 16px rgba(0,0,0,0.3); }
        .ur-footer-btn:active { transform: translateY(0) scale(.94); }
        .ur-footer-btn-danger:hover { background: rgba(218,55,60,0.2) !important; border-color: #da373c !important; box-shadow: 0 6px 16px rgba(218,55,60,0.3); }
        .ur-footer-btn-primary:hover { background: #5865f2 !important; border-color: #5865f2 !important; color: #fff !important; box-shadow: 0 6px 18px rgba(88,101,242,0.4); }
    `
    document.head.appendChild(s)
}

const CLIENT_EMOJI: Record<string, string> = {
    desktop:  "💻",
    mobile:   "📱",
    web:      "🌐",
    embedded: "🎮",
    vr:       "🥽",
}

function resolveClient(cs?: Record<string, string> | null): string | null {
    if (!cs) return null
    // priority order for the "primary" platform
    if (cs.mobile)   return "mobile"
    if (cs.desktop)  return "desktop"
    if (cs.web)      return "web"
    if (cs.embedded) return "embedded"
    if (cs.vr)       return "vr"
    const first = Object.keys(cs).find(k => cs[k])
    return first ?? null
}

// returns every active platform, not just one — display only
function resolveAllClients(cs?: Record<string, string> | null): string[] {
    if (!cs) return []
    return Object.keys(cs).filter(k => cs[k])
}

const CLIENT_LABEL_MAP: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", web: "Web", embedded: "Console", vr: "VR" }
function platformSuffixLog(uid: string): string {
    const c = clientCache[uid]
    if (!c) return ""
    return ` · on ${CLIENT_EMOJI[c] || "📡"} ${CLIENT_LABEL_MAP[c] || c}`
}

const C = {
    bg1:         "#1e1f22",
    bg2:         "#2b2d31",
    bg3:         "#313338",
    bgEl:        "#3f4147",
    border:      "#3f4147",
    hov:         "rgba(255,255,255,0.06)",
    header:      "#f2f3f5",
    subheader:   "#b5bac1",
    text:        "#dbdee1",
    muted:       "#949ba4",
    danger:      "#fa777c",
    brand:       "#5865f2",
    brandLight:  "#949cf4",
    brandGrad:   "linear-gradient(135deg, #5865f2 0%, #949cf4 100%)",
    green:       "#248046",
    red:         "#da373c",
    white:       "#ffffff",
    expanded:    "#232428",
} as const

const ico = {
    search:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    check:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    x:        () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    chevron:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>,
    trash:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    copy:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/></svg>,
    external: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    sortAz:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h12M3 12h8M3 18h4M16 8l4-4 4 4M20 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    sortDate: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    eye:      () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.white} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill={C.white} stroke="none"/><path d="M12 2v2M12 20v2" strokeWidth="1.5" opacity="0.5"/></svg>,
    ghost:    () => <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity=".25"><path d="M12 2a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-4h6v4h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9zm-3 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>,
    msg:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    edit:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    del:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 3v-1a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v1H3v2h2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5h2V3h-6zm-4-1h2v1h-2V2zm-2 5h2v9h-2V7zm4 0h2v9h-2V7z"/></svg>,
    typing:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>,
    profile:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/></svg>,
    avatar:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="2"/></svg>,
    voice:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>,
    status:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".3"/><circle cx="12" cy="12" r="5"/></svg>,
    activity: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>,
    joins:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M20 8v6M23 11h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    history:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    preview:  () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    catMsg:       () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    catEdit:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4L18.5 2.5z"/></svg>,
    catDelete:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    catTyping:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="18" x2="20" y2="18"/></svg>,
    catStatus:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>,
    catVoice:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>,
    catProfile:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    catActivity:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,

    location: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    clock:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    download: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    pin:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"><path d="M16 3l5 5-5.5 5.5L17 17l-2 2-4.5-4.5L5 20l-1-1 5.5-5.5L5 9l2-2 3.5 3.5L16 3z"/></svg>,
    pinOutline: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3l5 5-5.5 5.5L17 17l-2 2-4.5-4.5L5 20l-1-1 5.5-5.5L5 9l2-2 3.5 3.5L16 3z"/></svg>,
    compact:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>,
    upload:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    clear:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    calendar: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,

}

// per-event icon + color for activity log cards
const actIco = {
    message:   { color: "#5865f2", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg> },
    edit:      { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
    delete:    { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> },
    typing:    { color: "#949cf4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="20" cy="12" r="2.2"/></svg> },

    listening: { color: "#c586f5", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18a3 3 0 1 1-3-3h1V5.5a1 1 0 0 1 .8-.98l9-2a1 1 0 0 1 1.2.98v9a3 3 0 1 1-2-2.83V6.7l-7 1.56V15a3 3 0 0 1-3 3v0z"/></svg> },
    watching:  { color: "#9146ff", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="15" rx="2"/><path d="M8 21h8M12 19v2"/></svg> },
    playing:   { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h4v2H8v2H6v-2H4V9h2V7h2v2zm9.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM17 3H7a5 5 0 0 0-5 5v6a5 5 0 0 0 5 5h.5a3 3 0 0 0 2.4-1.2l1.4-1.87a2 2 0 0 1 3.4 0l1.4 1.87A3 3 0 0 0 16.5 19H17a5 5 0 0 0 5-5V8a5 5 0 0 0-5-5z"/></svg> },
    streaming: { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg> },
    camera:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> },
    screen:    { color: "#ff5e5e", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="8 12 11 9 13 11 16 8"/></svg> },

    voice:     { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg> },
    vcMove:    { color: "#dbdee1", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },

    online:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/></svg> },
    idle:      { color: "#f0b232", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.389 5.389 0 0 1 17.5 12c-3.03 0-5.5-2.47-5.5-5.5 0-1.33.47-2.55 1.26-3.5A9.04 9.04 0 0 0 12 3z"/></svg> },
    dnd:       { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><rect x="7.5" y="10.8" width="9" height="2.4" rx="1.2" fill="#1e1f22"/></svg> },
    offline:   { color: "#80848e", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg> },
    status:    { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35"/><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg> },
    customStatus: { color: "#949cf4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg> },

    profile:   { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
    avatar:    { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="10" r="3"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5"/></svg> },
    banner:    { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg> },
    bio:       { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg> },
    username:  { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2.5 12.5V2.5h10z"/><circle cx="6.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg> },
    pronouns:  { color: "#ff6b6b", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="14" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg> },

    join:      { color: "#23a55a", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
    leave:     { color: "#da373c", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/></svg> },

    session:   { color: "#949ba4", Icon: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
} as const

const CtxEyeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 0 1 0-1.113ZM17.25 12a5.25 5.25 0 1 1-10.5 0 5.25 5.25 0 0 1 10.5 0Z" clipRule="evenodd" />
    </svg>
)
const CtxEyeOffIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l18 18a.75.75 0 1 0 1.06-1.06l-18-18ZM22.676 12.553a11.249 11.249 0 0 1-2.631 4.31l-3.099-3.099a5.25 5.25 0 0 0-6.71-6.71L7.759 4.577a11.217 11.217 0 0 1 4.242-.827c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113Z" />
        <path d="M15.75 12c0 .18-.013.357-.037.53l-4.244-4.243A3.75 3.75 0 0 1 15.75 12ZM12.53 15.713l-4.243-4.244a3.75 3.75 0 0 0 4.244 4.243Z" />
        <path d="M6.75 12c0-.619.107-1.213.304-1.764l-3.1-3.1a11.25 11.25 0 0 0-2.63 4.31c-.12.362-.12.752 0 1.114 1.489 4.467 5.704 7.69 10.675 7.69 1.5 0 2.933-.294 4.242-.827l-2.477-2.477A5.25 5.25 0 0 1 6.75 12Z" />
    </svg>
)
const CtxGearIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style={{ width: 18, height: 18 }}>
        <path fillRule="evenodd" d="M2.25 5.25a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3V15a3 3 0 0 1-3 3h-3v.257c0 .597.237 1.17.659 1.591l.621.622a.75.75 0 0 1-.53 1.28h-9a.75.75 0 0 1-.53-1.28l.621-.622a2.25 2.25 0 0 0 .659-1.59V18h-3a3 3 0 0 1-3-3V5.25Zm1.5 0v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5Z" clipRule="evenodd" />
    </svg>
)

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            role="switch" aria-checked={on}
            onClick={() => onChange(!on)}
            style={{
                width: 36, height: 22, borderRadius: 11, flexShrink: 0,
                background: on ? "#5865f2" : "#3f4147",
                cursor: "pointer", position: "relative",
                transition: "background 150ms ease",
            }}
        >
            <div style={{
                position: "absolute", top: 2, left: on ? 16 : 2,
                width: 18, height: 18, borderRadius: "50%",
                background: C.white, boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                transition: "left 150ms cubic-bezier(0.4,0,0.2,1)",
            }} />
        </div>
    )
}

type LookupStage =
    | { s: "idle" }
    | { s: "loading" }
    | { s: "done"; user: any; av: string }
    | { s: "err"; msg: string }

function timeAgo(ts: number): string {
    const diff = Date.now() - ts
    const d    = new Date(ts)
    const now  = new Date()
    const mins = Math.floor(diff / 60000)
    const isSameDay = d.getDate() === now.getDate() &&
                      d.getMonth() === now.getMonth() &&
                      d.getFullYear() === now.getFullYear()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = d.getDate() === yesterday.getDate() &&
                        d.getMonth() === yesterday.getMonth() &&
                        d.getFullYear() === yesterday.getFullYear()

    if (mins < 1)    return "just now"
    if (mins < 60)   return `${mins}m ago`
    if (isSameDay)   return `${Math.floor(mins / 60)}h ago`
    if (isYesterday) return "Yesterday"
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function exactTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", hour12: true })
}

function decodeSnowflake(id: string) {
    try {
        const snowflake = BigInt(id)
        const timestamp = Number(snowflake >> 22n) + 1420070400000
        const workerId = Number((snowflake >> 17n) & 0x1Fn)
        const processId = Number((snowflake >> 12n) & 0x1Fn)
        const increment = Number(snowflake & 0xFFFn)
        return { timestamp, workerId, processId, increment, date: new Date(timestamp) }
    } catch {
        return null
    }
}

function AddUserInput({ rawId, setRawId, hasErr, lk, setLk, doLookup }: {
    rawId: string
    setRawId: (v: string) => void
    hasErr: boolean
    lk: LookupStage
    setLk: (v: LookupStage) => void
    doLookup: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    const [btnState, setBtnState] = React.useState<"idle" | "valid" | "searching" | "found" | "notfound">("idle")
    const btnRef = React.useRef<HTMLButtonElement>(null)
    const borderColor = hasErr ? C.red : focused ? C.brand : C.border

    React.useEffect(() => {
        const clean = rawId.trim().replace(/\D/g, "")
        if (lk.s === "loading") setBtnState("searching")
        else if (lk.s === "done") {
            setBtnState("found")
            const t = setTimeout(() => setBtnState("idle"), 2000)
            return () => clearTimeout(t)
        }
        else if (lk.s === "err") {
            setBtnState("notfound")
            const t = setTimeout(() => setBtnState("idle"), 3000)
            return () => clearTimeout(t)
        }
        else if (clean.length >= 17 && clean.length <= 20) setBtnState("valid")
        else setBtnState("idle")
    }, [rawId, lk.s])

    const btnStyle: React.CSSProperties = {
        borderRadius: 20,
        height: 40,
        boxSizing: "border-box",
        padding: "0 20px",
        color: "#ffffff",
        border: "none",
        fontSize: 14,
        fontWeight: 600,
        cursor: btnState === "idle" ? "not-allowed" : "pointer",
        flexShrink: 0,
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 200ms ease, opacity 200ms ease",
    }

    const getBtnBg = () => {
        if (btnState === "found") return "#248046"
        if (btnState === "notfound") return "#da373c"
        if (btnState === "searching") return "#4752c4"
        if (btnState === "valid") return "#5865f2"
        return "rgba(255,255,255,0.06)"
    }

    const getBtnText = () => {
        if (btnState === "found") return "Added ✓"
        if (btnState === "notfound") return "Not found"
        if (btnState === "searching") return <><span className="ur-spin" style={{ marginRight: 6 }} />Searching...</>
        return "look up"
    }

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <input
                    placeholder="paste a discord user id"
                    value={rawId}
                    onChange={(e) => { setRawId(e.target.value); if (hasErr) setLk({ s: "idle" }) }}
                    onKeyDown={(e) => { if (e.key === "Enter" && btnState !== "idle") doLookup() }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoFocus
                    style={{
                        background: "#1e1f22",
                        borderRadius: 20,
                        border: `1px solid ${borderColor}`,
                        height: 40,
                        boxSizing: "border-box",
                        padding: "0 14px",
                        transition: "border-color 150ms ease, box-shadow 150ms ease",
                        width: "100%",
                        fontSize: 14,
                        color: "#dbdee1",
                        outline: "none",
                        fontFamily: "inherit",
                        boxShadow: focused ? "inset 0 0 0 1px #5865f2" : "none",
                    }}
                />
                <div style={{ fontSize: 11, color: hasErr ? C.danger : C.muted, marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>
                    {hasErr ? <ico.x /> : null}
                    {hasErr ? (lk as any).msg : "developer mode → right-click user → copy user id"}
                </div>
            </div>
            <button
                ref={btnRef}
                onClick={() => { if (btnState !== "idle") doLookup() }}
                className={btnState === "notfound" ? "ur-shake" : btnState === "valid" ? "ur-pulse" : ""}
                style={{ ...btnStyle, background: getBtnBg(), opacity: btnState === "idle" ? 0.5 : 1 }}
            >
                {getBtnText()}
            </button>
        </div>
    )
}

function AddLabelInput({ label, setLabel, doAdd }: {
    label: string
    setLabel: (v: string) => void
    doAdd: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder='e.g. "bestie", "the rat", "ex"'
            maxLength={50}
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 50))}
            onKeyDown={(e) => { if (e.key === "Enter") doAdd() }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            style={{
                background: "#1e1f22",
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 40,
                boxSizing: "border-box",
                padding: "0 14px",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                width: "100%",
                fontSize: 14,
                color: "#dbdee1",
                outline: "none",
                fontFamily: "inherit",
                marginBottom: 14,
            }}
        />
    )
}

function AddUserSection({ onAdded }: { onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupStage>({ s: "idle" })
    const [copiedId, setCopiedId] = React.useState(false)

    const cleanId = rawId.trim().replace(/\D/g, "")
    const hasErr  = lk.s === "err"

    const copyId = (id: string) => {
        navigator.clipboard.writeText(id)
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 1200)
    }

    const doLookup = () => {
        if (!cleanId)                                    return setLk({ s: "err", msg: "enter a user id first" })
        if (cleanId.length < 17 || cleanId.length > 20) return setLk({ s: "err", msg: "discord ids are 17-20 digits" })
        if (isWatched(settings, cleanId))                return setLk({ s: "err", msg: "already on your watchlist" })

        setLk({ s: "loading" })
        RestAPI.get({
            url: `/users/${cleanId}/profile`,
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
        }).then((res: any) => {
            const d = camelize(res.body)
            setLk({ s: "done", user: d.user, av: avatarUrl(d.user.id, d.user.avatar, 64) })
        }).catch((e: any) => {
            const code = e?.status ?? e?.response?.status
            setLk({
                s: "err",
                msg: code === 404 ? "user not found"
                   : code === 403 ? "profile is private (no shared server) — you can still add by id"
                   : `request failed${code ? ` (${code})` : ""}`,
            })
        })
    }

    const doAdd = () => {
        if (lk.s !== "done") return
        addUser(settings, cleanId, label.trim().slice(0, 50))
        fetchNewUserBaseline(cleanId)
        setRawId(""); setLabel(""); setLk({ s: "idle" })
        onAdded()
    }

    return (
        <div className="ur-fade-in">
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 12 }}>
                add user
            </div>

            {lk.s !== "done" && (
                <AddUserInput
                    rawId={rawId}
                    setRawId={setRawId}
                    hasErr={hasErr}
                    lk={lk}
                    setLk={setLk}
                    doLookup={doLookup}
                />
            )}

            {lk.s === "done" && (
                <div className="ur-fade-in">
                    <div style={{
                        background: C.bg1,
                        borderRadius: 16,
                        border: `1px solid ${C.border}`,
                        marginBottom: 14,
                        overflow: "hidden",
                    }}>
                        <div style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <img
                                    src={lk.av}
                                    style={{
                                        width: 52, height: 52,
                                        borderRadius: "50%",
                                        border: `2px solid ${C.border}`,
                                        flexShrink: 0,
                                        background: C.bg1,
                                    }}
                                    onError={(e: any) => { e.target.src = FALLBACK_AV }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 17, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>
                                            {lk.user.globalName || lk.user.username}
                                        </span>
                                        {lk.user.globalName && (
                                            <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>@{lk.user.username}</span>
                                        )}
                                    </div>
                                    {lk.user.pronouns && (
                                        <div style={{ fontSize: 11, color: C.brandLight, marginTop: 2, fontWeight: 500 }}>
                                            {lk.user.pronouns}
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    width: 20, height: 20,
                                    borderRadius: "50%",
                                    background: "rgba(36,128,70,0.15)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}>
                                    <span style={{ color: C.green, display: "flex", transform: "scale(0.8)" }}><ico.check /></span>
                                </div>
                            </div>

                            {lk.user.bio && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 4 }}>
                                        About Me
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: C.text,
                                        lineHeight: 1.5,
                                        padding: "8px 10px",
                                        background: C.bg2,
                                        borderRadius: 8,
                                        border: `1px solid ${C.border}`,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                    }}>
                                        {lk.user.bio}
                                    </div>
                                </div>
                            )}

                            <div style={{ height: 1, background: C.border, margin: "8px 0" }} />

                            {(() => {
                                const sf = decodeSnowflake(lk.user.id)
                                return sf && (
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 5 }}>
                                        Account Info
                                    </div>
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(2, 1fr)",
                                        gap: 6,
                                    }}>
                                        <div
                                            onClick={() => copyId(lk.user.id)}
                                            style={{
                                                padding: "8px 10px",
                                                background: C.bg2,
                                                borderRadius: 8,
                                                border: `1px solid ${C.border}`,
                                                cursor: "pointer",
                                                transition: "border-color 150ms ease, background 150ms ease",
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = "#232428" }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg2 }}
                                            title="Click to copy ID"
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>User ID</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.text, display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.user.id}</span>
                                                <span style={{ color: copiedId ? C.green : C.muted, flexShrink: 0, transition: "color 150ms ease", display: "flex" }}>
                                                    {copiedId ? <ico.check /> : <ico.copy />}
                                                </span>
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Created</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {sf.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                                                {sf.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Account Age</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {(() => {
                                                    const diff = Date.now() - sf.timestamp
                                                    const years = Math.floor(diff / 31536000000)
                                                    const months = Math.floor((diff % 31536000000) / 2592000000)
                                                    const days = Math.floor((diff % 2592000000) / 86400000)
                                                    if (years > 0) return `${years}y ${months}mo`
                                                    if (months > 0) return `${months}mo ${days}d`
                                                    return `${days}d`
                                                })()}
                                            </div>
                                        </div>

                                        <div
                                            title={`Worker ${sf.workerId} · Process ${sf.processId} · Increment ${sf.increment}`}
                                            style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Snowflake</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.brandLight, fontWeight: 600 }}>
                                                w{sf.workerId} · p{sf.processId}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1, fontFamily: "monospace" }}>
                                                inc {sf.increment}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                )
                            })()}
                        </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 6 }}>
                        label <span style={{ fontWeight: 500, color: C.muted, textTransform: "none" }}>(optional, only you see this)</span>
                    </div>
                    <AddLabelInput label={label} setLabel={setLabel} doAdd={doAdd} />

                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={doAdd}
                            style={{
                                flex: 1,
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 20px",
                                background: C.green,
                                color: "#ffffff",
                                border: "none",
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#2d9c5a" }}
                            onMouseLeave={e => { e.currentTarget.style.background = C.green }}
                        >
                            add to watchlist
                        </button>
                        <button
                            onClick={() => { setLk({ s: "idle" }); setLabel("") }}
                            style={{
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 18px",
                                background: "transparent",
                                color: C.text,
                                border: `1px solid ${C.border}`,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease, border-color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = "rgba(255,255,255,0.05)"
                                e.currentTarget.style.borderColor = C.bgEl
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.borderColor = C.border
                            }}
                        >
                            cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

const OV_GROUPS = {
    messages: [
        { label: "messages",  key: "msgs",     gk: "globalMsgs",     Icon: ico.msg,      desc: "Notify on new messages" },
        { label: "edits",     key: "edits",    gk: "globalEdits",    Icon: ico.edit,     desc: "Notify on message edits" },
        { label: "deletes",   key: "deletes",  gk: "globalDeletes",  Icon: ico.del,      desc: "Notify on deleted messages" },
        { label: "typing",    key: "typing",   gk: "globalTyping",   Icon: ico.typing,   desc: "Notify when typing starts" },
    ],
    presence: [
        { label: "status",    key: "status",   gk: "globalStatus",   Icon: ico.status,   desc: "Notify on status changes" },
        { label: "activity",  key: "activity", gk: "globalActivity", Icon: ico.activity, desc: "Game/music activity (off by default)" },
        { label: "voice",     key: "voice",    gk: "globalVoice",    Icon: ico.voice,    desc: "Notify on voice channel activity" },
        { label: "joins",     key: "joins",    gk: "globalJoins",    Icon: ico.joins,    desc: "Notify on server joins / leaves" },
    ],
    profile: [
        { label: "profile",   key: "profile",  gk: "globalProfile",  Icon: ico.profile,  desc: "Notify on profile changes" },
        { label: "avatar",    key: "avatar",   gk: "globalAvatar",   Icon: ico.avatar,   desc: "Notify on avatar updates" },
    ],
} as const

type OvTab = "messages" | "presence" | "profile"
const OV_TAB_LABELS: Record<OvTab, string> = { messages: "Messages", presence: "Presence", profile: "Profile" }
const OV_TAB_ICONS: Record<OvTab, () => JSX.Element> = {
    messages: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    presence: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".25"/><circle cx="12" cy="12" r="5"/></svg>,
    profile:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
}

function LabelInput({ nick, setNick, saveNick }: { nick: string; setNick: (v: string) => void; saveNick: () => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder="label"
            maxLength={50}
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 50))}
            onBlur={() => { setFocused(false); saveNick() }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { setFocused(false); saveNick() } }}
            style={{
                background: C.bg1,
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : C.border}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 26,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                fontSize: 12,
                width: "100%",
                margin: 0,
                color: C.text,
                outline: "none",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                fontFamily: "inherit",
            }}
        />
    )
}

function SearchInput({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <div style={{ position: "relative", width: 160, flexShrink: 0 }}>
            <input
                placeholder="search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => setFocused(false)}
                onFocus={() => setFocused(true)}
                style={{
                    background: "#1e1f22",
                    borderRadius: 20,
                    border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                    boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                    height: 28,
                    boxSizing: "border-box",
                    padding: "0 28px 0 12px",
                    width: "100%",
                    fontSize: 13,
                    color: "#dbdee1",
                    outline: "none",
                    fontFamily: "inherit",
                    transition: "border-color 150ms ease, box-shadow 150ms ease",
                }}
            />
            <div style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#949ba4",
                display: query ? "none" : "flex",
                alignItems: "center",
                pointerEvents: "none",
            }}>
                <ico.search />
            </div>
            {query && (
                <div
                    role="button"
                    onClick={() => setQuery("")}
                    style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#949ba4",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        lineHeight: 1,
                    }}
                >
                    <ico.x />
                </div>
            )}
        </div>
    )
}

function previewNotification(uid: string, type: string) {
    const u = UserStore.getUser(uid)
    const label = getWatchedUser(settings, uid)?.nick
    const name = displayName(u) || uid
    const dn = label ? `${label} (${name})` : name
    const icon = u ? avatarUrl(u.id, (u as any).avatar) : undefined

    const previews: Record<string, { title: string; body: string }> = {
        msgs:     { title: `${dn} sent a message`, body: "This is a preview of how message notifications will appear." },
        edits:    { title: `${dn} edited a message`, body: `"before" → "after preview text"` },
        deletes:  { title: `${dn} deleted a message`, body: `"this is a preview of deleted message content"` },
        typing:   { title: `${dn} is typing…`, body: "in #general" },
        status:   { title: `${dn} is now online`, body: "was: offline" },
        activity: { title: `${dn} is playing Game Name`, body: "doing something — details here" },
        voice:    { title: `${dn} joined voice`, body: "#General Voice" },
        joins:    { title: `${dn} joined a server`, body: "Server Name" },
        profile:  { title: `${dn} updated their profile`, body: "bio, display name" },
        avatar:   { title: `${dn} changed their avatar`, body: "click to see new pfp" },
    }

    const p = previews[type] || { title: `${dn}: ${type}`, body: "preview notification" }
    notify({ title: "[Preview] " + p.title, body: p.body, icon })
}

// known-good public logos — only apps i can confirm resolve, no guessing broken urls
const MUSIC_APP_ICONS: Record<string, string> = {
    "spotify":        "https://cdn.simpleicons.org/spotify/1ED760",
    "apple music":    "https://cdn.simpleicons.org/applemusic/FA243C",
    "youtube music":  "https://cdn.simpleicons.org/youtubemusic/FF0000",
    "tidal":          "https://cdn.simpleicons.org/tidal/000000",
    "deezer":         "https://cdn.simpleicons.org/deezer/FEAA2D",
    "soundcloud":     "https://cdn.simpleicons.org/soundcloud/FF5500",
    "pandora":        "https://cdn.simpleicons.org/pandora/224099",
    "qobuz":          "https://cdn.simpleicons.org/qobuz/000000",
    "last.fm":        "https://cdn.simpleicons.org/lastdotfm/D51007",
}

// one resolver for games and listening. only works when discord actually sends asset
// data though — a lot of games (minecraft's xbox rpc included) send just an appId with
// no assets, so the icon has to come from the app's own public record instead — see below
const appIconCache: Record<string, string | null> = {}
const _appIconFetching: Partial<Record<string, Promise<string | null>>> = {}

async function fetchAppIcon(appId: string): Promise<string | null> {
    if (appId in appIconCache) return appIconCache[appId]
    if (_appIconFetching[appId]) return _appIconFetching[appId]
    const p = (async () => {
        try {
            const { body } = await RestAPI.get({ url: `/applications/${appId}/rpc` })
            const icon = body?.icon
            const url = icon ? `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=128` : null
            appIconCache[appId] = url
            return url
        } catch {
            appIconCache[appId] = null
            return null
        } finally {
            delete _appIconFetching[appId]
        }
    })()
    _appIconFetching[appId] = p
    return p
}

function resolveActivityImage(act: any): string {
    const img = act.assets?.large_image || act.assets?.largeImage || ""
    const appId = act.application_id || act.applicationId || ""
    if (img.startsWith("spotify:")) return `https://i.scdn.co/image/${img.slice(8)}`
    if (img.startsWith("twitch:")) return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${img.slice(7)}-256x144.jpg`
    if (img.startsWith("youtube:")) return `https://i.ytimg.com/vi/${img.slice(8)}/hqdefault.jpg`
    if (img.startsWith("mp:external/")) return `https://media.discordapp.net/external/${img.slice(12)}`
    if (img.startsWith("mp:app-asset/")) return `https://media.discordapp.net/app-assets/${img.slice(13)}`
    if (img.startsWith("mp:")) return `https://media.discordapp.net/${img.slice(3)}`
    if (img.startsWith("http")) return img
    // some console-linked / embedded RPCs (Xbox, PlayStation, activity SDK games) send the
    // media-proxy path without discord's "mp:" scheme in front — same asset, missing prefix.
    // these got dropped straight to the controller icon before since they don't match any
    // case above and always contain a "/", tripping the old blanket "!img.includes(':')" guard.
    if (img.startsWith("external/")) return `https://media.discordapp.net/${img}`
    if (img.startsWith("app-asset/")) return `https://media.discordapp.net/${img}`
    if (appId && img && !img.includes(":")) return `https://cdn.discordapp.com/app-assets/${appId}/${img}.png`
    if (act.type === 2) return MUSIC_APP_ICONS[(act.name || "").toLowerCase()] || ""
    return ""
}

function getActivityIconKey(entry: ActivityEntry): keyof typeof actIco {
    const type = entry.type
    const meta = entry.metadata || {}

    // exact type first so a msg containing "spotify" isn't mis-tagged
    if (type === "msg") return "message"
    if (type === "edit") return "edit"
    if (type === "delete") return "delete"
    if (type === "typing") return "typing"
    if (type === "profile") return "profile"
    if (type === "avatar") return "avatar"
    if (type === "banner") return "banner"
    if (type === "bio") return "bio"
    if (type === "username" || type === "displayname") return "username"
    if (type === "pronouns") return "pronouns"
    if (type === "custom_status") return "customStatus"
    if (type === "join") return "join"
    if (type === "leave") return "leave"
    if (type === "vc_move") return "vcMove"
    if (type === "game_start" || type === "game_stop") return "playing"
    if (type === "spotify") return "listening"
    if (type === "streaming") return "watching"
    if (type === "online") return "online"
    if (type === "offline") return "offline"
    if (type === "idle") return "idle"
    if (type === "dnd") return "dnd"

    // camera/screenshare log as type "voice" while live, check metadata
    if (type === "voice" || type === "vc_join" || type === "vc_leave") {
        const action = (meta.action || "").toLowerCase()
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        return "voice"
    }

    // activity/session are generic — real kind lives in metadata
    if (type === "activity" || type === "session") {
        const action = (meta.action || "").toLowerCase()
        const activityType = meta.type

        if (action === "status_session") return "status"
        if (action.includes("listening") || activityType === 2 || meta.trackId) return "listening"
        if (action.includes("voice")) return "voice"
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        if (action.includes("game") || activityType === 0) return "playing"
        if (activityType === 1) return "watching"

        return "session"
    }

    if (type === "status") return "status"

    return "session"
}

function formatDuration(ms: number): string {
    if (!ms || ms < 0) return "0m"
    const totalSeconds = Math.floor(ms / 1000)
    const mins = Math.floor(totalSeconds / 60)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
        const remainingHours = hours % 24
        const remainingMins = mins % 60
        if (remainingHours > 0 && remainingMins > 0) return `${days}d ${remainingHours}h ${remainingMins}m`
        if (remainingHours > 0) return `${days}d ${remainingHours}h`
        return `${days}d ${remainingMins}m`
    }
    if (hours > 0) {
        const remainingMins = mins % 60
        if (remainingMins > 0) return `${hours}h ${remainingMins}m`
        return `${hours}h`
    }
    if (mins > 0) {
        const remainingSecs = totalSeconds % 60
        if (remainingSecs > 0) return `${mins}m ${remainingSecs}s`
        return `${mins}m`
    }
    return `${totalSeconds}s`
}

const _albumColorCache: Record<string, string> = {}
const ALBUM_CACHE_MAX = 300  // small hex strings, but cap it so long sessions don't grow this forever

function extractAlbumColor(imageUrl: string): Promise<string> {
    if (_albumColorCache[imageUrl]) return Promise.resolve(_albumColorCache[imageUrl])
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas")
                const ctx = canvas.getContext("2d")
                if (!ctx) { resolve("#1ed760"); return }
                const size = 64
                canvas.width = size
                canvas.height = size
                ctx.drawImage(img, 0, 0, size, size)
                const data = ctx.getImageData(0, 0, size, size).data

                const buckets: Record<string, { r: number; g: number; b: number; count: number; satSum: number }> = {}
                const bucketSize = 24 // quantize to 24-unit steps

                for (let i = 0; i < data.length; i += 8) { // sample every 2nd pixel for speed
                    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
                    if (a < 128) continue

                    const max = Math.max(r, g, b)
                    const min = Math.min(r, g, b)
                    const lum = (max + min) / 2
                    // Skip near-white, near-black, and very low saturation
                    if (lum < 35 || lum > 240) continue
                    if (max - min < 30) continue // too gray

                    const sat = max === 0 ? 0 : (max - min) / max
                    if (sat < 0.15) continue // skip low saturation

                    const br = Math.floor(r / bucketSize) * bucketSize
                    const bg = Math.floor(g / bucketSize) * bucketSize
                    const bb = Math.floor(b / bucketSize) * bucketSize
                    const key = `${br},${bg},${bb}`

                    if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0, satSum: 0 }
                    buckets[key].r += r
                    buckets[key].g += g
                    buckets[key].b += b
                    buckets[key].count++
                    buckets[key].satSum += sat
                }

                let bestKey = ""
                let bestScore = 0
                for (const key in buckets) {
                    const b = buckets[key]
                                const avgSat = b.satSum / b.count
                    const score = b.count * avgSat
                    if (score > bestScore) {
                        bestScore = score
                        bestKey = key
                    }
                }

                let hex: string
                if (bestKey && buckets[bestKey]) {
                    const b = buckets[bestKey]
                    const avgR = Math.round(b.r / b.count)
                    const avgG = Math.round(b.g / b.count)
                    const avgB = Math.round(b.b / b.count)
                    hex = `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`
                } else {
                    hex = "#1ed760"
                }

                _albumColorCache[imageUrl] = hex
                const keys = Object.keys(_albumColorCache)
                if (keys.length > ALBUM_CACHE_MAX) delete _albumColorCache[keys[0]]
                resolve(hex)
            } catch {
                resolve("#1ed760")
            }
        }
        img.onerror = () => resolve("#1ed760")
        img.src = imageUrl
    })
}
function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

const ACTIVITY_CATEGORIES = [
    { key: "msg" as ActivityType, label: "Messages", Icon: ico.catMsg, color: "#5865f2" },
    { key: "edit" as ActivityType, label: "Edits", Icon: ico.catEdit, color: "#f0b232" },
    { key: "delete" as ActivityType, label: "Deletes", Icon: ico.catDelete, color: "#da373c" },
    { key: "typing" as ActivityType, label: "Typing", Icon: ico.catTyping, color: "#949cf4" },
    { key: "status" as ActivityType, label: "Status", Icon: ico.catStatus, color: "#23a55a" },
    { key: "voice" as ActivityType, label: "Voice", Icon: ico.catVoice, color: "#dbdee1" },
    { key: "profile" as ActivityType, label: "Profile", Icon: ico.catProfile, color: "#ff6b6b" },
    { key: "activity" as ActivityType, label: "Activity", Icon: ico.catActivity, color: "#f0b232" },
] as const

function matchesCategory(log: ActivityEntry, category: ActivityType): boolean {
    if (category === "msg") return log.type === "msg"
    if (category === "edit") return log.type === "edit"
    if (category === "delete") return log.type === "delete"
    if (category === "typing") return log.type === "typing"
    if (category === "status") {
        return log.type === "online" || log.type === "offline" || log.type === "idle" || log.type === "dnd" || log.type === "status" || log.type === "custom_status" || (log.type === "session" && log.metadata?.action === "status_session")
    }
    if (category === "voice") return log.type === "voice" || log.type === "vc_join" || log.type === "vc_leave" || log.type === "vc_move" || (log.type === "session" && (["voice_session", "stream_session", "camera_session"].includes(log.metadata?.action || "") || (log.metadata?.action || "").includes("voice")))
    if (category === "profile") return log.type === "profile" || log.type === "avatar" || log.type === "banner" || log.type === "bio" || log.type === "username" || log.type === "displayname" || log.type === "pronouns"
    if (category === "activity") return log.type === "activity" || log.type === "game_start" || log.type === "game_stop" || log.type === "spotify" || log.type === "streaming" || (log.type === "session" && (log.metadata?.action || "").includes("activity"))
    return log.type === category
}

function ActivityCardIcon({ log }: { log: ActivityEntry }) {
    const [failed, setFailed] = React.useState(false)
    const isListening = log.metadata?.type === 2 || (log.metadata?.action || "").includes("listening")
    const appLogo = isListening ? MUSIC_APP_ICONS[(log.metadata?.appName || "").toLowerCase()] : ""
    const storedUrl = log.metadata?.iconUrl || log.metadata?.gameIconUrl || (isListening ? "" : log.metadata?.albumArtUrl) || ""
    const appId = log.metadata?.applicationId || ""
    // heals old entries logged before appIconCache existed
    const [healedUrl, setHealedUrl] = React.useState(() => (appId ? appIconCache[appId] || "" : ""))
    React.useEffect(() => {
        if (storedUrl || !appId || healedUrl || appIconCache[appId] !== undefined) return
        let live = true
        fetchAppIcon(appId).then(url => { if (live && url) setHealedUrl(url) }).catch(() => {})
        return () => { live = false }
    }, [storedUrl, appId, healedUrl])
    const realUrl = appLogo || storedUrl || healedUrl
    const key = getActivityIconKey(log)
    const { Icon, color } = actIco[key]
    const showImg = realUrl && !failed
    return (
        <div data-ur-card-icon className="ur-log-icon" style={{
            width: 42, height: 42, borderRadius: appLogo ? "50%" : 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, marginTop: 1, overflow: "hidden",
            background: showImg ? C.bg1 : `${color}1c`,
            border: appLogo ? "none" : `1px solid ${showImg ? C.border : color + "40"}`,
            color,
        }}>
            {showImg
                ? <img src={realUrl} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: appLogo ? "contain" : "cover", padding: appLogo ? 4 : 0 }} />
                : <Icon />}
        </div>
    )
}

// on-avatar status badges — built from the provided status SVG set instead of flat
// color dots. online/dnd/offline are complete self-contained badge shapes already;
// idle's source asset is just the crescent glyph with no backing circle, so it gets
// composited onto a solid circle here (crescent recolored to the card bg to "bite" it)
// to read as a full badge like the other three, matching Discord's real idle icon.
function StatusBadgeIcon({ status }: { status: string }) {
    if (status === "online") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path d="M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8Z" fill="#45a366" />
            </svg>
        )
    }
    if (status === "dnd") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path fillRule="evenodd" clipRule="evenodd" d="M8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16ZM5.24902 7C4.69674 7 4.24902 7.44772 4.24902 8C4.24902 8.55229 4.69674 9 5.24902 9H10.7499C11.3022 9 11.7499 8.55229 11.7499 8C11.7499 7.44772 11.3022 7 10.7499 7H5.24902Z" fill="#e00000" />
            </svg>
        )
    }
    if (status === "idle") {
        return (
            <svg viewBox="0 0 24 24" width="100%" height="100%" style={{ transform: "scaleX(-1)" }}>
                <path d="M12.0557 3.59974C12.2752 3.2813 12.2913 2.86484 12.0972 2.53033C11.9031 2.19582 11.5335 2.00324 11.1481 2.03579C6.02351 2.46868 2 6.76392 2 12C2 17.5228 6.47715 22 12 22C17.236 22 21.5313 17.9764 21.9642 12.8518C21.9967 12.4664 21.8041 12.0968 21.4696 11.9027C21.1351 11.7086 20.7187 11.7248 20.4002 11.9443C19.4341 12.6102 18.2641 13 17 13C13.6863 13 11 10.3137 11 6.99996C11 5.73589 11.3898 4.56587 12.0557 3.59974Z" fill="#ffc04e" />
            </svg>
        )
    }
    // offline / invisible — hollow ring, same as Discord's real offline badge
    return (
        <svg viewBox="0 0 16 16" width="100%" height="100%">
            <path fillRule="evenodd" clipRule="evenodd" d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2ZM0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8Z" fill="#84858d" />
        </svg>
    )
}

function LogCard({ log, expanded, onToggle, onDelete, userId, index }: {
    log: ActivityEntry
    expanded: boolean
    onToggle: () => void
    onDelete: (id: string) => void
    userId: string
    index?: number
}) {
    return (
            <div
                key={log.id}
                data-ur-card-body
                className={`ur-log-card${expanded ? " open" : ""}`}
                onClick={() => onToggle()}
                style={{
                    display: "flex",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 18,
                    background: expanded
                        ? "linear-gradient(135deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.03) 100%)"
                        : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                    border: `1px solid ${expanded ? C.bgEl : C.border}`,
                    marginBottom: 6,
                    cursor: "pointer",
                    minHeight: 56,
                    animationDelay: `${Math.min(index ?? 0, 12) * 22}ms`,
                }}
            >
                <ActivityCardIcon log={log} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    {(() => {
                        // Check if this log entry has an ongoing active session
                        const isLiveSession = Object.values(activeSessions).some(s => s.logId === log.id)
                        return isLiveSession ? (
                            <div data-ur-card-live style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 10,
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                                color: "#23a55a",
                                background: "rgba(35,165,90,0.12)",
                                border: "1px solid rgba(35,165,90,0.3)",
                                borderRadius: 8,
                                padding: "3px 8px",
                                marginBottom: 5,
                            }}>
                                <span className="ur-blink-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#23a55a", flexShrink: 0 }} />
                                Live
                            </div>
                        ) : null
                    })()}
                    <div data-ur-card-title style={{
                        fontSize: log.type === "msg" || log.type === "edit" || log.type === "delete" ? 15 : 14,
                        fontWeight: 800,
                        color: C.header,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                    }}>
                        <span style={{ wordBreak: "break-word", flex: 1, minWidth: 0 }}>
                            {(() => {
                                // still in vc — show "In #channel" not "joined"
                                const isLive = Object.values(activeSessions).some(s => s.logId === log.id)
                                if (isLive && log.type === "voice" && log.metadata?.action === "joined") {
                                    return `In #${log.metadata.channel || "voice"}`
                                }
                                return log.title
                            })()}
                        </span>
                        <span style={{
                            fontSize: 12,
                            color: C.subheader,
                            fontWeight: 700,
                            background: C.bg1,
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: `1px solid ${C.border}`,
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }} title={exactTime(log.ts)}>
                            <span style={{ display: "flex", alignItems: "center" }}><ico.clock /></span>
                            {new Date(log.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                            <span style={{ color: C.muted, fontWeight: 500 }}>· {timeAgo(log.ts)}</span>
                        </span>
                        <div className={`ur-log-chevron${expanded ? " open" : ""}`} title={expanded ? "Collapse" : "Expand"}>
                            <ico.chevron />
                        </div>
                        <div
                            role="button"
                            title="Delete this entry"
                            onClick={async (e) => {
                                e.stopPropagation()
                                if (!confirm("Delete this activity entry?")) return
                                await activityStore.removeLog(userId, log.id)
                                onDelete(log.id)
                            }}
                            style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                cursor: "pointer",
                                background: "transparent",
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                opacity: 0.4,
                                transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.opacity = "1"
                                e.currentTarget.style.background = "rgba(218,55,60,0.12)"
                                e.currentTarget.style.color = C.red
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.opacity = "0.4"
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.color = C.muted
                            }}
                        >
                            <ico.trash />
                        </div>
                    </div>
                    {log.body && log.body !== log.title && log.type !== "activity" && log.type !== "session" && log.type !== "edit" && log.metadata?.action !== "status_session" && (
                        <div data-ur-card-body-text={(log.type === "msg" || log.type === "delete") ? "content" : "meta"} style={{
                            fontSize: log.type === "msg" || log.type === "delete" ? 14 : 13,
                            color: log.type === "msg" || log.type === "delete" ? C.text : C.muted,
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                            fontWeight: log.type === "msg" || log.type === "delete" ? 500 : 400,
                            marginTop: log.type === "msg" || log.type === "delete" ? 2 : 0,
                        }}>
                            {log.body}
                        </div>
                    )}
                    {(log.type === "msg" || log.type === "edit" || log.type === "delete" || log.type === "voice" || log.type === "activity" || (log.type === "session" && ["listening_session", "activity_session", "voice_session", "camera_session", "stream_session"].includes(log.metadata?.action))) && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.location /></span>
                            <span>
                                {(log.type === "activity" || log.type === "session") && log.metadata?.appName
                                    ? log.metadata.appName
                                    : log.metadata?.server || "Unknown"}
                                {log.metadata?.channel ? ` · #${log.metadata.channel}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "session" && log.metadata?.action === "status_session" && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.status /></span>
                            <span>
                                {log.metadata?.platform ? `${CLIENT_EMOJI[log.metadata.platform.toLowerCase()] || "📡"} ${log.metadata.platform}` : "Status session"}
                                {log.metadata?.duration ? ` · ${log.metadata.duration}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "edit" && log.metadata?.before && (
                        <div style={{
                            marginTop: 10,
                            borderRadius: 14,
                            overflow: "hidden",
                            border: `1px solid rgba(240,178,50,0.25)`,
                        }}>
                            <div style={{ padding: "8px 14px", background: "rgba(240,178,50,0.08)", fontSize: 10, fontWeight: 800, color: "#f0b232", textTransform: "uppercase", letterSpacing: 0.6, display: "flex", alignItems: "center", gap: 6 }}>
                                <ico.edit />
                                Message Edit
                            </div>
                            <div style={{ padding: "10px 14px", borderBottom: log.metadata?.after ? `1px solid rgba(240,178,50,0.15)` : "none", background: "rgba(218,55,60,0.06)" }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Before</div>
                                <span style={{ fontSize: 12, textDecoration: "line-through", opacity: 0.7, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                    {trunc(log.metadata.before, 300)}
                                </span>
                            </div>
                            {log.metadata?.after && (
                                <div style={{ padding: "10px 14px", background: "rgba(36,128,70,0.06)" }}>
                                    <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>After</div>
                                    <span style={{ fontSize: 12, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                        {trunc(log.metadata.after, 300)}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    <div className={`ur-expand${expanded ? " open" : ""}`}>
                        <div className={expanded ? "ur-log-expand-in" : ""}>
                            {(log.channelId || log.guildId) && (
                                <div
                                    onClick={(e) => { e.stopPropagation(); jumpTo(log.guildId, log.channelId, log.msgId) }}
                                    style={{
                                        marginTop: 10,
                                        padding: "10px 16px",
                                        background: C.brand,
                                        borderRadius: 10,
                                        color: C.white,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        textAlign: "center",
                                        fontFamily: "inherit",
                                        transition: "background 150ms ease",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "#4752c4" }}
                                    onMouseLeave={e => { e.currentTarget.style.background = C.brand }}
                                >
                                    <ico.external />
                                    Jump to Discord
                                </div>
                            )}
                            {/* Profile field before/after diff card */}
                            {(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && log.metadata && (log.metadata.before !== undefined || log.metadata.after !== undefined || log.metadata.oldAvatar !== undefined || log.metadata.newAvatar !== undefined) && (
                                <div style={{
                                    marginTop: 10,
                                    borderRadius: 14,
                                    overflow: "hidden",
                                    border: `1px solid rgba(255,107,107,0.3)`,
                                }}>
                                    {/* Header */}
                                    <div style={{
                                        padding: "8px 14px",
                                        background: "rgba(255,107,107,0.12)",
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        color: "#ff6b6b",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                    }}>
                                        <span style={{ display: "flex", alignItems: "center", transform: "scale(0.7)" }}>
                                            {(() => {
                                                const key = getActivityIconKey(log)
                                                const { Icon } = actIco[key]
                                                return <Icon />
                                            })()}
                                        </span>
                                        <span>{FIELD_NAME[log.metadata.field ?? ""] ?? log.type.replace("_", " ")} change</span>
                                    </div>
                                    {/* Avatar images row */}
                                    {log.type === "avatar" && (log.metadata.oldAvatar || log.metadata.newAvatar) && (
                                        <div style={{
                                            display: "flex",
                                            gap: 12,
                                            padding: "14px",
                                            background: C.bg1,
                                            alignItems: "center",
                                        }}>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Before</div>
                                                {log.metadata.oldAvatar
                                                    ? <img src={log.metadata.oldAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid ${C.border}` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                            <div style={{ fontSize: 20, color: C.muted, flexShrink: 0 }}>→</div>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>After</div>
                                                {log.metadata.newAvatar
                                                    ? <img src={log.metadata.newAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid rgba(255,107,107,0.5)` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid rgba(255,107,107,0.5)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                        </div>
                                    )}
                                    {/* Text before/after */}
                                    {log.type !== "avatar" && (
                                        <div style={{ background: C.bg1 }}>
                                            {log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>Before</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(218,55,60,0.08)",
                                                        border: "1px solid rgba(218,55,60,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                        textDecoration: "line-through",
                                                        opacity: 0.8,
                                                    }}>
                                                        {String(log.metadata.before)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(36,128,70,0.08)",
                                                        border: "1px solid rgba(36,128,70,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                    }}>
                                                        {String(log.metadata.after)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after == null && log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        fontStyle: "italic",
                                                        padding: "8px 10px",
                                                    }}>
                                                        (removed)
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            {log.metadata && log.type !== "msg" && log.type !== "edit" && log.type !== "delete" && !(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && (
                                <div style={{
                                    marginTop: 10,
                                    padding: "12px 16px",
                                    background: C.bg1,
                                    borderRadius: 12,
                                    fontSize: 12,
                                    color: C.muted,
                                    lineHeight: 1.6,
                                    border: `1px solid ${C.border}`,
                                }}>
                                    {log.metadata.song && (
                                        <div
                                            ref={(el: any) => {
                                                if (!el || !log.metadata?.albumArtUrl) return
                                                const cached = _albumColorCache[log.metadata.albumArtUrl]
                                                if (cached) {
                                                    el.style.background = hexToRgba(cached, 0.06)
                                                    el.style.borderColor = hexToRgba(cached, 0.35)
                                                    return
                                                }
                                                extractAlbumColor(log.metadata!.albumArtUrl!).then((hex: string) => {
                                                    if (el) {
                                                        el.style.background = hexToRgba(hex, 0.06)
                                                        el.style.borderColor = hexToRgba(hex, 0.35)
                                                    }
                                                })
                                            }}
                                            style={{
                                                display: "flex",
                                                gap: 0,
                                                marginBottom: 12,
                                                borderRadius: 10,
                                                border: "1px solid rgba(30,215,96,0.2)",
                                                overflow: "hidden",
                                                background: "rgba(30,215,96,0.06)",
                                                transition: "background 300ms ease, border-color 300ms ease",
                                                position: "relative",
                                                minHeight: 160,
                                            }}
                                        >
                                            {log.metadata.albumArtUrl && (
                                                <div style={{
                                                    position: "relative",
                                                    width: 160,
                                                    height: 160,
                                                    overflow: "hidden",
                                                    borderRadius: 10,
                                                    flexShrink: 0,
                                                    alignSelf: "center",
                                                }}>
                                                    <img
                                                        src={log.metadata.albumArtUrl}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            left: 0,
                                                            width: "100%",
                                                            height: "100%",
                                                            objectFit: "cover",
                                                            display: "block",
                                                            borderRadius: 8,
                                                        }}
                                                        onError={(e: any) => { e.target.style.display = "none" }}
                                                    />
                                                    <div style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        right: 0,
                                                        width: 50,
                                                        height: "100%",
                                                        background: "linear-gradient(to right, transparent, rgba(0,0,0,0.4))",
                                                        pointerEvents: "none",
                                                    }} />
                                                </div>
                                            )}
                                            <div style={{
                                                flex: 1,
                                                minWidth: 0,
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "center",
                                                padding: "14px 16px",
                                                gap: 1,
                                            }}>
                                                {log.metadata.appName && (
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.8,
                                                        color: C.brandLight,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 5,
                                                        marginBottom: 4,
                                                    }}>
                                                        {log.metadata.appName === "Spotify" && <span>🎵</span>}
                                                        {log.metadata.appName}
                                                    </div>
                                                )}
                                                <div style={{
                                                    fontSize: 16,
                                                    fontWeight: 800,
                                                    color: C.header,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    lineHeight: 1.2,
                                                    letterSpacing: -0.2,
                                                }}>
                                                    {log.metadata.song}
                                                </div>
                                                {log.metadata.artist && (
                                                    <div style={{
                                                        fontSize: 14,
                                                        color: C.text,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        fontWeight: 500,
                                                        marginTop: 2,
                                                    }}>
                                                        {log.metadata.artist}
                                                    </div>
                                                )}
                                                {log.metadata.album && (
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        marginTop: 1,
                                                    }}>
                                                        {log.metadata.album}
                                                    </div>
                                                )}
                                                <div style={{
                                                    display: "flex",
                                                    gap: 6,
                                                    marginTop: 8,
                                                    flexWrap: "wrap",
                                                    alignItems: "center",
                                                }}>
                                                    {Array.isArray(log.metadata.allArtists) && log.metadata.allArtists.length > 1 && (
                                                        <span style={{
                                                            fontSize: 10,
                                                            color: C.muted,
                                                            background: "rgba(0,0,0,0.25)",
                                                            padding: "2px 8px",
                                                            borderRadius: 10,
                                                            fontWeight: 600,
                                                        }} title={`All artists: ${log.metadata.allArtists.join(", ")}`}>
                                                            +{log.metadata.allArtists.length - 1} more
                                                        </span>
                                                    )}
                                                    {log.metadata.contextUri && (
                                                        <span style={{
                                                            fontSize: 10,
                                                            color: C.muted,
                                                            background: "rgba(0,0,0,0.25)",
                                                            padding: "2px 8px",
                                                            borderRadius: 10,
                                                            fontWeight: 600,
                                                        }} title={log.metadata.contextUri}>
                                                            {log.metadata.contextUri.includes("playlist") ? "🎶 Playlist" : log.metadata.contextUri.includes("album") ? "💿 Album" : "🎵 Context"}
                                                        </span>
                                                    )}
                                                </div>
                                                {(() => {
                                                    // discord's own endTimestamp is optional and rarely sent outside spotify —
                                                    // fall back to the plugin's own captured start/end wall-clock times
                                                    const hasDiscordRange = log.metadata.startTimestamp && log.metadata.endTimestamp
                                                    const startTs = hasDiscordRange ? log.metadata.startTimestamp : log.metadata.startTime
                                                    const endTs = hasDiscordRange ? log.metadata.endTimestamp : (log.metadata.endTime || Date.now())
                                                    if (!startTs) return null

                                                    const total = endTs - startTs
                                                    const totalStr = formatDuration(total)
                                                    // full bar if ended, live calc if still going
                                                    const isSession = log.type === "session"
                                                    const elapsed = isSession && log.metadata.endTime
                                                        ? log.metadata.endTime - startTs
                                                        : Date.now() - startTs
                                                    const progress = Math.min(100, Math.max(0, (elapsed / total) * 100))
                                                    const currentStr = formatDuration(Math.min(elapsed, total))
                                                    return (
                                                        <div style={{ marginTop: 12 }}>
                                                            <div style={{
                                                                height: 4,
                                                                background: "rgba(0,0,0,0.3)",
                                                                borderRadius: 2,
                                                                overflow: "hidden",
                                                            }}>
                                                                <div style={{
                                                                    width: `${progress}%`,
                                                                    height: "100%",
                                                                    background: C.brandLight,
                                                                    borderRadius: 2,
                                                                    transition: "width 0.3s ease",
                                                                }} />
                                                            </div>
                                                            <div style={{
                                                                display: "flex",
                                                                justifyContent: "space-between",
                                                                marginTop: 5,
                                                                fontSize: 11,
                                                                color: C.muted,
                                                                fontWeight: 600,
                                                                letterSpacing: 0.3,
                                                            }}>
                                                                <span>{currentStr}</span>
                                                                <span>{totalStr}</span>
                                                            </div>
                                                        </div>
                                                    )
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                    {log.metadata.gameIconUrl && !log.metadata.song && (
                                        <div style={{
                                            display: "flex",
                                            gap: 12,
                                            marginBottom: 12,
                                            padding: "10px 12px",
                                            background: "rgba(88,101,242,0.08)",
                                            borderRadius: 10,
                                            border: "1px solid rgba(88,101,242,0.2)",
                                        }}>
                                            <img
                                                src={log.metadata.gameIconUrl}
                                                style={{
                                                    width: 56, height: 56,
                                                    borderRadius: 12,
                                                    objectFit: "cover",
                                                    flexShrink: 0,
                                                    border: `1px solid ${C.border}`,
                                                }}
                                                onError={(e: any) => { e.target.style.display = "none" }}
                                            />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                {log.metadata.appName && (
                                                    <div style={{
                                                        fontSize: 9,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.6,
                                                        color: C.brandLight,
                                                        marginBottom: 3,
                                                    }}>
                                                        {log.metadata.appName}
                                                    </div>
                                                )}
                                                {log.metadata.details && (
                                                    <div style={{
                                                        fontSize: 13,
                                                        fontWeight: 800,
                                                        color: C.header,
                                                        marginBottom: 2,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}>
                                                        {log.metadata.details}
                                                    </div>
                                                )}
                                                {log.metadata.state && (
                                                    <div style={{
                                                        fontSize: 11,
                                                        color: C.muted,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}>
                                                        {log.metadata.state}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {log.metadata.duration && log.metadata.action !== "listening_session" && (
                                        <div style={{
                                            marginBottom: 10,
                                            padding: "10px 14px",
                                            background: C.bg1,
                                            borderRadius: 10,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <div style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                marginBottom: 8,
                                            }}>
                                                <span style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    color: C.brandLight,
                                                }}><ico.clock /></span>
                                                <span style={{ color: C.brandLight, fontWeight: 800, fontSize: 13 }}>
                                                    {log.metadata.duration}
                                                </span>
                                            </div>

                                            {log.metadata.startTime && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                        <div style={{
                                                            width: 8, height: 8, borderRadius: "50%",
                                                            background: C.green,
                                                            flexShrink: 0,
                                                            boxShadow: `0 0 0 3px ${C.green}30`,
                                                        }} />
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                                                                {log.metadata.action === "status_session" ? "Online" :
                                                                 log.metadata.action === "activity_session" || log.metadata.action === "listening_session" ? "Started" : "Joined"}
                                                            </div>
                                                            <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                                                                {new Date(log.metadata.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                                                                <span style={{ color: C.muted, fontWeight: 500, marginLeft: 6 }}>
                                                                    {new Date(log.metadata.startTime).toLocaleDateString([], { month: "short", day: "numeric" })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 3 }}>
                                                        <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, ${C.green}, ${C.red})`, borderRadius: 1 }} />
                                                        <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>
                                                            {log.metadata.duration}
                                                        </div>
                                                    </div>

                                                    {log.metadata.endTime && (
                                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                            <div style={{
                                                                width: 8, height: 8, borderRadius: "50%",
                                                                background: C.red,
                                                                flexShrink: 0,
                                                                boxShadow: `0 0 0 3px ${C.red}30`,
                                                            }} />
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                                                                    {log.metadata.action === "status_session" ? "Offline" :
                                                                     log.metadata.action === "activity_session" || log.metadata.action === "listening_session" ? "Stopped" : "Left"}
                                                                </div>
                                                                <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                                                                    {new Date(log.metadata.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                                                                    <span style={{ color: C.muted, fontWeight: 500, marginLeft: 6 }}>
                                                                        {new Date(log.metadata.endTime).toLocaleDateString([], { month: "short", day: "numeric" })}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {!log.metadata.endTime && (
                                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                            <div style={{
                                                                width: 8, height: 8, borderRadius: "50%",
                                                                background: C.brand,
                                                                flexShrink: 0,
                                                                animation: "ur-pulse 2s infinite",
                                                            }} />
                                                            <div style={{ fontSize: 12, color: C.brandLight, fontWeight: 700 }}>
                                                                Still active…
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {log.metadata.action === "status_session" && Array.isArray(log.metadata.statusTimeline) && log.metadata.statusTimeline.length > 0 && (
                                        <div style={{
                                            marginBottom: 10,
                                            padding: "12px 14px",
                                            background: C.bg1,
                                            borderRadius: 10,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <div style={{
                                                fontSize: 10,
                                                fontWeight: 800,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.8,
                                                color: C.subheader,
                                                marginBottom: 10,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                            }}>
                                                <span style={{ display: "flex", alignItems: "center" }}><ico.status /></span>
                                                Status Timeline
                                            </div>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                                {log.metadata.statusTimeline.map((ch: any, i: number) => (
                                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                                                        <div style={{
                                                            width: 10, height: 10, borderRadius: "50%",
                                                            background: ch.status === "online" ? "#23a55a" : ch.status === "idle" ? "#f0b232" : ch.status === "dnd" ? "#da373c" : "#80848e",
                                                            flexShrink: 0,
                                                            boxShadow: `0 0 0 3px ${ch.status === "online" ? "#23a55a30" : ch.status === "idle" ? "#f0b23230" : ch.status === "dnd" ? "#da373c30" : "#80848e30"}`,
                                                        }} />
                                                        {i < log.metadata!.statusTimeline.length - 1 && (
                                                            <div style={{
                                                                position: "absolute",
                                                                left: 4,
                                                                top: 14,
                                                                width: 2,
                                                                height: 24,
                                                                background: C.border,
                                                                borderRadius: 1,
                                                            }} />
                                                        )}
                                                        <div style={{ flex: 1, minWidth: 0, paddingBottom: i < log.metadata!.statusTimeline.length - 1 ? 8 : 0 }}>
                                                            <div style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 6,
                                                                flexWrap: "wrap",
                                                            }}>
                                                                <span style={{
                                                                    fontSize: 12,
                                                                    fontWeight: 700,
                                                                    color: C.header,
                                                                }}>
                                                                    {ch.emoji} {ch.label}
                                                                </span>
                                                                <span style={{
                                                                    fontSize: 10,
                                                                    color: C.muted,
                                                                    fontFamily: "monospace",
                                                                    marginLeft: "auto",
                                                                }}>
                                                                    {ch.time}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {Array.isArray(log.metadata.platformTimeline) && log.metadata.platformTimeline.length > 0 && (
                                                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.8,
                                                        color: C.subheader,
                                                        marginBottom: 8,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                    }}>
                                                        <span style={{ display: "flex", alignItems: "center" }}><ico.activity /></span>
                                                        Platform Changes
                                                    </div>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                                        {log.metadata.platformTimeline.map((pt: any, i: number) => (
                                                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                                                                <div style={{
                                                                    width: 10, height: 10, borderRadius: "50%",
                                                                    background: C.brandLight,
                                                                    flexShrink: 0,
                                                                    boxShadow: `0 0 0 3px ${C.brandLight}30`,
                                                                }} />
                                                                {i < log.metadata!.platformTimeline.length - 1 && (
                                                                    <div style={{
                                                                        position: "absolute",
                                                                        left: 4,
                                                                        top: 14,
                                                                        width: 2,
                                                                        height: 24,
                                                                        background: C.border,
                                                                        borderRadius: 1,
                                                                    }} />
                                                                )}
                                                                <div style={{ flex: 1, minWidth: 0, paddingBottom: i < log.metadata!.platformTimeline.length - 1 ? 8 : 0 }}>
                                                                    <div style={{
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                        flexWrap: "wrap",
                                                                    }}>
                                                                        <span style={{
                                                                            fontSize: 12,
                                                                            fontWeight: 700,
                                                                            color: C.header,
                                                                        }}>
                                                                            {CLIENT_EMOJI[pt.platform.toLowerCase()] || "📡"} {CLIENT_LABEL_MAP[pt.platform] || pt.platform}
                                                                        </span>
                                                                        <span style={{
                                                                            fontSize: 10,
                                                                            color: C.muted,
                                                                            fontFamily: "monospace",
                                                                            marginLeft: "auto",
                                                                        }}>
                                                                            {pt.time}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div style={{
                                                marginTop: 10,
                                                paddingTop: 8,
                                                borderTop: `1px solid ${C.border}`,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                            }}>
                                                <span style={{ fontSize: 10, color: C.muted }}>
                                                    Started {new Date(log.metadata.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                                                </span>
                                                <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    color: C.brandLight,
                                                    background: "rgba(88,101,242,0.1)",
                                                    padding: "2px 8px",
                                                    borderRadius: 6,
                                                }}>
                                                    {log.metadata.duration}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {log.metadata.platform && (
                                        <div style={{
                                            display: "flex",
                                            gap: 10,
                                            marginBottom: 8,
                                            alignItems: "center",
                                            padding: "6px 10px",
                                            background: C.bg2,
                                            borderRadius: 8,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <span style={{ color: C.brandLight, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Platform</span>
                                            <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>
                                                {CLIENT_EMOJI[log.metadata.platformKey || String(log.metadata.platform).toLowerCase()] || "📡"} {CLIENT_LABEL_MAP[log.metadata.platform] || log.metadata.platform}
                                            </span>
                                        </div>
                                    )}
                                    {Object.entries(log.metadata)
                                        .filter(([key, val]) =>
                                            !["duration","startTime","endTime","members","metadata","type","action","name","song","artist","allArtists","album","trackId","albumId","artistIds","contextUri","trackType","albumArtUrl","largeImage","smallImage","smallText","statusDisplayType","createdAt","sessionId","partyId","partySize","appName","appLogo","gameIconUrl","applicationId","parentApplicationId","platform","platformKey","flags","buttons","secrets","url","startTimestamp","endTimestamp","timestamps","party","assets","statusTimeline","platformTimeline","startStatus","endStatus","changeCount","before","after","field","oldAvatar","newAvatar"].includes(key) &&
                                            val !== undefined && val !== null && val !== "" &&
                                            !(typeof val === "object" && Object.keys(val).length === 0)
                                        )
                                        .map(([key, val]) => (
                                        <div key={key} style={{
                                            display: "flex",
                                            gap: 10,
                                            marginBottom: 6,
                                            alignItems: "center",
                                            padding: "6px 10px",
                                            background: C.bg2,
                                            borderRadius: 8,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <span style={{
                                                color: C.brandLight,
                                                minWidth: 80,
                                                fontWeight: 700,
                                                fontSize: 11,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.5
                                            }}>{key}</span>
                                            <span style={{
                                                color: C.text,
                                                wordBreak: "break-word",
                                                flex: 1,
                                                fontSize: 12,
                                                fontWeight: 600,
                                            }}>
                                                {typeof val === "object" ? JSON.stringify(val) : String(val)}
                                            </span>
                                        </div>
                                    ))}
                                    {Array.isArray(log.metadata.members) && log.metadata.members.length > 0 && (
                                        <div style={{ display: "flex", gap: 10, marginBottom: 4, alignItems: "baseline" }}>
                                            <span style={{ color: C.brandLight, minWidth: 80, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>WITH</span>
                                            <span style={{ color: C.text, flex: 1, wordBreak: "break-word" }}>{(log.metadata.members as string[]).join(", ")}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
    )
}

function UserRadarActivityTab({ userId }: { userId: string }) {
    const [logs, setLogs] = React.useState<ActivityEntry[]>([])
    const [activeFilters, setActiveFilters] = React.useState<Set<ActivityType>>(new Set())
    const [expandedId, setExpandedId] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [sortMode, setSortMode] = React.useState<"newest" | "oldest">("newest")
    const [compact, setCompact] = React.useState(() => !!settings.store.compactLogView)
    // only mount this many cards at first — rest load in on demand so opening
    // the log with hundreds of entries doesn't freeze on a big DOM dump
    const [visibleCount, setVisibleCount] = React.useState(60)
    React.useEffect(() => { setVisibleCount(60) }, [activeFilters, searchQuery, sortMode])

    const toggleCompact = () => {
        const next = !compact
        setCompact(next)
        settings.store.compactLogView = next
    }

    React.useEffect(() => {
        const load = async () => {
            await activityStore.load()
            setLogs(activityStore.getLogs(userId))
            setLoading(false)
        }
        load()
        const unsub = onActivityUpdate((uid, entry) => {
            if (uid !== userId) return
            setLogs(prev => {
                const existingIdx = prev.findIndex(l => l.id === entry.id)
                if (existingIdx === -1) return [entry, ...prev]
                // replace in place so a closing session doesn't duplicate
                const next = [...prev]
                next.splice(existingIdx, 1)
                return [entry, ...next]
            })
        })
        const unsubRemove = onActivityRemove((uid, logId) => {
            if (uid !== userId) return
            setLogs(prev => prev.filter(l => l.id !== logId))
        })
        return () => { unsub(); unsubRemove() }
    }, [userId])

    const toggleFilter = (key: ActivityType) => {
        setActiveFilters(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const clearFilters = () => {
        setActiveFilters(new Set())
    }

    const deleteCategory = async (cat: typeof ACTIVITY_CATEGORIES[number]) => {
        const count = logs.filter(l => matchesCategory(l, cat.key)).length
        if (count === 0) return
        if (!confirm(`Delete all ${count} ${cat.label.toLowerCase()} cards for this user? This cannot be undone.`)) return
        await activityStore.removeLogsWhere(userId, l => matchesCategory(l, cat.key))
        setLogs(prev => prev.filter(l => !matchesCategory(l, cat.key)))
        setActiveFilters(prev => {
            if (!prev.has(cat.key)) return prev
            const next = new Set(prev)
            next.delete(cat.key)
            return next
        })
    }

    const filtered = React.useMemo(() => {
        let result = logs
        if (activeFilters.size > 0) {
            result = result.filter(l => {
                for (const filter of activeFilters) {
                    if (matchesCategory(l, filter)) return true
                }
                return false
            })
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            result = result.filter(l =>
                l.title.toLowerCase().includes(q) ||
                l.body.toLowerCase().includes(q) ||
                l.type.toLowerCase().includes(q) ||
                (l.metadata?.appName && l.metadata.appName.toLowerCase().includes(q)) ||
                (l.metadata?.song && l.metadata.song.toLowerCase().includes(q)) ||
                (l.metadata?.artist && l.metadata.artist.toLowerCase().includes(q))
            )
        }
        const sorted = [...result]
        if (sortMode === "oldest") sorted.sort((a, b) => a.ts - b.ts)
        return sorted
    }, [logs, activeFilters, searchQuery, sortMode])

    const visibleFiltered = React.useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

    const grouped = React.useMemo(() => {
        return visibleFiltered.reduce((acc, log) => {
            const date = new Date(log.ts).toLocaleDateString()
            if (!acc[date]) acc[date] = []
            acc[date].push(log)
            return acc
        }, {} as Record<string, ActivityEntry[]>)
    }, [visibleFiltered])

    const categoryCounts = React.useMemo(() => {
        const counts: Record<string, number> = {}
        for (const cat of ACTIVITY_CATEGORIES) {
            counts[cat.key] = logs.filter(l => matchesCategory(l, cat.key)).length
        }
        return counts
    }, [logs])

    const todayStats = React.useMemo(() => {
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const dayStartMs = startOfDay.getTime()
        const now = Date.now()
        const todayLogs = logs.filter(l => l.ts >= dayStartMs)

        const msgCount = todayLogs.filter(l => l.type === "msg").length

        let voiceMs = 0
        for (const l of todayLogs) {
            if (l.type === "session" && typeof l.metadata?.startTime === "number" && typeof l.metadata?.endTime === "number") {
                // clamp to today in case it started yesterday
                const start = Math.max(l.metadata.startTime, dayStartMs)
                voiceMs += Math.max(0, l.metadata.endTime - start)
            }
        }
        // include ongoing session time too
        for (const s of Object.values(activeSessions)) {
            if (s.logId && todayLogs.some(l => l.id === s.logId)) {
                const start = Math.max(s.startTime, dayStartMs)
                voiceMs += Math.max(0, now - start)
            }
        }

        const statusChanges = todayLogs.filter(l => matchesCategory(l, "status")).length

        return { msgCount, voiceMs, statusChanges, total: todayLogs.length }
    }, [logs])

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
                <div className="ur-spin" style={{ width: 24, height: 24, margin: "0 auto 12px" }} />
                <div style={{ fontSize: 13 }}>Loading activity log...</div>
            </div>
        )
    }

    return (
        <div style={{ padding: "0 4px" }}>
            {logs.length > 0 && (
                <div style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 12,
                    flexWrap: "wrap",
                }}>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.msgCount}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>messages today</div>
                    </div>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.voiceMs > 0 ? formatDuration(todayStats.voiceMs) : "0m"}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>voice today</div>
                    </div>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.statusChanges}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>status changes</div>
                    </div>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.total}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>events today</div>
                    </div>
                </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
                <div className="ur-glass" style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: 20 }}>
                    <input
                        placeholder="Search activity..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            background: "rgba(255,255,255,0.04)",
                            borderRadius: 20,
                            border: `1px solid ${C.border}`,
                            height: 32,
                            boxSizing: "border-box",
                            padding: "0 32px 0 12px",
                            width: "100%",
                            fontSize: 13,
                            color: C.text,
                            outline: "none",
                            fontFamily: "inherit",
                            transition: "border-color 150ms ease, box-shadow 150ms ease",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.boxShadow = `0 0 0 1px ${C.brand}40` }}
                        onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none" }}
                    />
                    <div style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: C.muted,
                        display: "flex",
                        alignItems: "center",
                        pointerEvents: "none",
                    }}>
                        <ico.search />
                    </div>
                </div>

                <div
                    role="button"
                    tabIndex={0}
                    className="ur-chip ur-tab-btn ur-glass"
                    onClick={() => setSortMode(s => s === "newest" ? "oldest" : "newest")}
                    style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "0 10px",
                        borderRadius: 20,
                        cursor: "pointer",
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${C.border}`,
                        color: C.muted,
                        fontSize: 11,
                        fontWeight: 600,
                        userSelect: "none",
                        height: 32,
                        boxSizing: "border-box",
                        transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                        flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.08)" }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "rgba(255,255,255,0.04)" }}
                >
                    {sortMode === "newest" ? <ico.sortDate /> : <ico.sortAz />}
                    {sortMode === "newest" ? "Newest" : "Oldest"}
                </div>

                <div
                    role="button"
                    tabIndex={0}
                    className="ur-chip ur-tab-btn ur-glass"
                    title={compact ? "switch to normal view" : "switch to compact view"}
                    onClick={toggleCompact}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 32,
                        borderRadius: 20,
                        cursor: "pointer",
                        background: compact ? `${C.brand}25` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${compact ? C.brand : C.border}`,
                        color: compact ? C.brandLight : C.muted,
                        height: 32,
                        boxSizing: "border-box",
                        transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                        flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!compact) { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.08)" } }}
                    onMouseLeave={e => { if (!compact) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "rgba(255,255,255,0.04)" } }}
                >
                    <ico.compact />
                </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                {ACTIVITY_CATEGORIES.map(cat => {
                    const isActive = activeFilters.has(cat.key)
                    const count = categoryCounts[cat.key] || 0
                    return (
                        <div
                            key={cat.key}
                            className="ur-chip ur-tab-btn ur-glass"
                            onClick={() => toggleFilter(cat.key)}
                            style={{
                                padding: "5px 10px",
                                borderRadius: 16,
                                background: isActive ? `${cat.color}25` : "rgba(255,255,255,0.04)",
                                color: isActive ? cat.color : C.muted,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                transition: "background 150ms ease, color 150ms ease, border-color 150ms ease",
                                userSelect: "none",
                                border: `1px solid ${isActive ? `${cat.color}60` : C.border}`,
                                opacity: count === 0 ? 0.5 : 1,
                                flexShrink: 0,
                            }}
                            onMouseEnter={e => {
                                if (!isActive) {
                                    e.currentTarget.style.background = "rgba(255,255,255,0.09)"
                                    e.currentTarget.style.color = C.text
                                }
                            }}
                            onMouseLeave={e => {
                                if (!isActive) {
                                    e.currentTarget.style.background = "rgba(255,255,255,0.04)"
                                    e.currentTarget.style.color = C.muted
                                }
                            }}
                        >
                            {isActive && (
                                <span
                                    className="ur-blink-dot"
                                    style={{
                                        display: "inline-block",
                                        width: 5,
                                        height: 5,
                                        borderRadius: "50%",
                                        background: cat.color,
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <span style={{ display: "flex", alignItems: "center" }}><cat.Icon /></span>
                            <span>{cat.label}</span>
                            <span style={{
                                background: isActive ? `${cat.color}40` : C.bg3,
                                padding: "1px 5px",
                                borderRadius: 6,
                                fontSize: 9,
                                fontWeight: 800,
                                color: isActive ? cat.color : C.muted,
                            }}>
                                {count}
                            </span>
                            {count > 0 && (
                                <span
                                    className="ur-chip-trash"
                                    title={`Delete all ${cat.label.toLowerCase()} cards`}
                                    onClick={e => { e.stopPropagation(); deleteCategory(cat) }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        width: 14,
                                        height: 14,
                                        marginLeft: 1,
                                        borderRadius: 4,
                                        color: C.muted,
                                        opacity: 0.55,
                                        transition: "opacity 120ms ease, color 120ms ease",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = C.red }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.color = C.muted }}
                                >
                                    <ico.trash />
                                </span>
                            )}
                        </div>
                    )
                })}

                {activeFilters.size > 0 && (
                    <div
                        onClick={clearFilters}
                        style={{
                            padding: "5px 10px",
                            borderRadius: 12,
                            background: "transparent",
                            color: C.muted,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            transition: "all 150ms ease",
                            userSelect: "none",
                            border: `1px solid ${C.border}`,
                            flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.borderColor = C.danger }}
                        onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border }}
                    >
                        <ico.x />
                        Clear
                    </div>
                )}
            </div>

            <div className={compact ? "ur-compact" : ""} style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                paddingRight: 4,
            }}>
                {Object.entries(grouped).map(([date, dayLogs]) => (
                    <div key={date}>
                        <div data-ur-day-header style={{
                            fontSize: 10,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                            color: C.muted,
                            marginBottom: 8,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <ico.calendar />
                                {date === new Date().toLocaleDateString() ? "Today" : date}
                            </span>
                            <span style={{ flex: 1, height: 1, background: C.border }} />
                            <span>{dayLogs.length} events</span>
                        </div>
                        {dayLogs.map((log, i) => (
                            <LogCard
                                key={log.id}
                                log={log}
                                expanded={expandedId === log.id}
                                onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                                onDelete={(id) => setLogs(prev => prev.filter(l => l.id !== id))}
                                userId={userId}
                                index={i}
                            />
                        ))}
                    </div>
                ))}
                {filtered.length > visibleCount && (
                    <button
                        className="ur-tab-btn ur-chip"
                        onClick={() => setVisibleCount(v => v + 60)}
                        style={{
                            alignSelf: "center",
                            marginTop: 4,
                            padding: "8px 16px",
                            borderRadius: 20,
                            background: C.bg1,
                            border: `1px solid ${C.border}`,
                            color: C.text,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            transition: "all 150ms ease",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = C.bg2 }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg1 }}
                    >
                        <ico.download />
                        Load more · {filtered.length - visibleCount} left
                    </button>
                )}
                {logs.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
                        <div style={{
                            width: 56,
                            height: 56,
                            borderRadius: "50%",
                            background: C.bg1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto 14px",
                            border: `1px solid ${C.border}`,
                        }}>
                            <ico.ghost />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.header }}>No activity tracked yet</div>
                        <div style={{ fontSize: 12, marginTop: 4, color: C.muted }}>Events will appear here once this user does something</div>
                    </div>
                )}
                {logs.length > 0 && filtered.length === 0 && (
                    <div style={{ textAlign: "center", padding: "32px 0", color: C.muted }}>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, opacity: 0.5 }}>
                            <ico.search />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>No matching events</div>
                        <div style={{ fontSize: 11, marginTop: 3 }}>Try adjusting your filters or search</div>
                    </div>
                )}
            </div>

                    </div>
    )
}

// activity count badge

function ActivityLogFooter({ userId, onRefresh }: { userId: string; onRefresh?: () => void }) {
    const [count, setCount] = React.useState(0)
    const [exportCat, setExportCat] = React.useState<ActivityType | "all">("all")

    React.useEffect(() => {
        const load = async () => {
            await activityStore.load()
            setCount(activityStore.getLogs(userId).length)
        }
        load()
        const unsub = onActivityUpdate((uid) => {
            if (uid === userId) setCount(activityStore.getLogs(userId).length)
        })
        const unsubRemove = onActivityRemove((uid) => {
            if (uid === userId) setCount(activityStore.getLogs(userId).length)
        })
        return () => { unsub(); unsubRemove() }
    }, [userId])

    return (
        <div style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
            width: "100%",
        }}>
            <span style={{ fontSize: 11, color: C.muted, marginRight: "auto" }}>
                {count} total events logged
            </span>
            <button
                className="ur-tab-btn ur-chip"
                onClick={() => {
                    const input = document.createElement("input")
                    input.type = "file"
                    input.accept = ".json"
                    input.onchange = async (e: any) => {
                        const file = e.target.files[0]
                        if (!file) return
                        try {
                            const text = await file.text()
                            const ok = await activityStore.importAll(text)
                            if (ok) {
                                onRefresh?.()
                                Toasts.show({
                                    message: `Imported activity log`,
                                    id: Toasts.genId(),
                                    type: Toasts.Type.SUCCESS,
                                })
                            } else {
                                Toasts.show({
                                    message: "Failed to import — invalid JSON file",
                                    id: Toasts.genId(),
                                    type: Toasts.Type.FAILURE,
                                })
                            }
                        } catch (err: any) {
                            Toasts.show({
                                message: `Import failed: ${err?.message || "could not read file"}`,
                                id: Toasts.genId(),
                                type: Toasts.Type.FAILURE,
                            })
                        }
                    }
                    input.click()
                }}
                style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    background: C.bg1,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = C.bg2 }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg1 }}
            >
                <ico.download />
                Import
            </button>
            <select
                className="ur-tab-btn"
                value={exportCat}
                onChange={(e) => setExportCat(e.target.value as ActivityType | "all")}
                style={{
                    padding: "0 10px",
                    height: 34,
                    borderRadius: 20,
                    background: C.bg1,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    outline: "none",
                }}
                title="what to export"
            >
                <option value="all">All categories</option>
                {ACTIVITY_CATEGORIES.map(cat => (
                    <option key={cat.key} value={cat.key}>{cat.label} only</option>
                ))}
            </select>
            <button
                className="ur-tab-btn ur-chip"
                onClick={() => {
                    const userLogs = activityStore.getLogs(userId)
                    const scoped = exportCat === "all" ? userLogs : userLogs.filter(l => matchesCategory(l, exportCat))
                    if (scoped.length === 0) {
                        Toasts.show({
                            message: exportCat === "all" ? "No activity to export" : `No ${exportCat} logs to export`,
                            id: Toasts.genId(),
                            type: Toasts.Type.FAILURE,
                        })
                        return
                    }
                    const data = JSON.stringify({ [userId]: scoped }, null, 2)
                    const blob = new Blob([data], { type: "application/json" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    const suffix = exportCat === "all" ? "" : `_${exportCat}`
                    a.href = url
                    a.download = `userradar_${userId}${suffix}_${new Date().toISOString().slice(0,10)}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    Toasts.show({
                        message: `Exported ${scoped.length} ${exportCat === "all" ? "events" : exportCat + " events"}`,
                        id: Toasts.genId(),
                        type: Toasts.Type.SUCCESS,
                    })
                }}
                style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    background: C.bg1,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = C.bg2 }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg1 }}
            >
                <ico.upload />
                Export
            </button>
            <button
                className="ur-tab-btn ur-chip"
                onClick={async () => {
                    if (count === 0) {
                        Toasts.show({
                            message: "No activity to clear",
                            id: Toasts.genId(),
                            type: Toasts.Type.FAILURE,
                        })
                        return
                    }
                    if (confirm("Clear all history for this user? This cannot be undone.")) {
                        await activityStore.clearLogs(userId)
                        onRefresh?.()
                    }
                }}
                style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    background: "rgba(218,55,60,0.08)",
                    border: `1px solid ${C.red}`,
                    color: C.red,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(218,55,60,0.15)" }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(218,55,60,0.08)" }}
            >
                <ico.clear />
                Clear
            </button>
        </div>
    )
}

function ActivityBadge({ userId }: { userId: string }) {
    const [count, setCount] = React.useState(0)
    const [loaded, setLoaded] = React.useState(false)

    React.useEffect(() => {
        let mounted = true
        const load = async () => {
            await activityStore.load()
            if (mounted) {
                setCount(activityStore.getLogs(userId).length)
                setLoaded(true)
            }
        }
        load()
        const unsub = onActivityUpdate((uid) => {
            if (uid === userId && mounted) {
                setCount(activityStore.getLogs(userId).length)
            }
        })
        const unsubRemove = onActivityRemove((uid) => {
            if (uid === userId && mounted) {
                setCount(activityStore.getLogs(userId).length)
            }
        })
        return () => { mounted = false; unsub(); unsubRemove() }
    }, [userId])

    return (
        <span style={{
            fontSize: 10,
            fontWeight: 800,
            background: count > 0 ? C.brand : loaded ? C.bg3 : C.bg1,
            padding: "2px 6px",
            borderRadius: 6,
            color: count > 0 ? C.white : loaded ? C.muted : "transparent",
            minWidth: 18,
            textAlign: "center",
            lineHeight: 1,
            transition: "all 150ms ease",
        }}>
            {loaded ? count : ""}
        </span>
    )
}

function WatchedRow({ user, refresh, expandedId, setExpandedId, onRemove, isPinned, onTogglePin, index }: {
    user: WatchedUser
    refresh: () => void
    expandedId: string | null
    setExpandedId: (id: string | null) => void
    onRemove: () => void
    isPinned?: boolean
    onTogglePin?: () => void
    index?: number
}) {
    const [nick,     setNick] = React.useState(user.nick || "")
    const expanded = expandedId === user.id
    const setExp = (v: boolean) => setExpandedId(v ? user.id : null)
    const [copied,   setCopy] = React.useState(false)
    const [ovTab,    setOvTab] = React.useState<OvTab>("messages")
    const [liveStatus, setLiveStatus] = React.useState<string>(() => statusCache[user.id] || "offline")

    React.useEffect(() => {
        const presMod = findByProps("getStatus", "getActivities")
        const tick = () => {
            try {
                const s = presMod?.getStatus?.(user.id)
                if (s) setLiveStatus(s)
            } catch { }
        }
        tick()
        const iv = setInterval(tick, 4000)
        return () => clearInterval(iv)
    }, [user.id])

    const du   = UserStore.getUser(user.id)
    const name = displayName(du) || user.id
    const av   = du ? avatarUrl(du.id, (du as any).avatar, 64) : avatarUrl(user.id, null, 64)

    const saveNick = () => { patchUser(settings, user.id, { nick: (nick || "").slice(0, 50) }); refresh() }
    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        const dn = label ? `${label} (${name})` : name
        const featLabel = OV_GROUPS.messages.find(r => r.key === key)?.label
            || OV_GROUPS.presence.find(r => r.key === key)?.label
            || OV_GROUPS.profile.find(r => r.key === key)?.label
            || key
        if (val === true) {
            Toasts.show({ type: Toasts.Type.SUCCESS, message: `${dn}: ${featLabel} enabled`, id: Toasts.genId() })
        } else if (val === false) {
            Toasts.show({ type: Toasts.Type.MESSAGE, message: `${dn}: ${featLabel} disabled`, id: Toasts.genId() })
        } else if (val === null) {
            Toasts.show({ type: Toasts.Type.SUCCESS, message: `${dn}: ${featLabel} reset to global`, id: Toasts.genId() })
        }
    }

    const copyId = () => {
        navigator.clipboard.writeText(user.id)
        setCopy(true)
        setTimeout(() => setCopy(false), 1200)
    }

    const resetAll = () => {
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = {}
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => {
                newOverrides[r.key] = null
            })
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        Toasts.show({ type: Toasts.Type.SUCCESS, message: `${label ? `${label} (${name})` : name}: all overrides reset`, id: Toasts.genId() })
    }

    const enableAll = () => {
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = { ...list[idx].overrides }
        OV_GROUPS[ovTab].forEach(r => {
            newOverrides[r.key] = true
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        Toasts.show({ type: Toasts.Type.SUCCESS, message: `${label ? `${label} (${name})` : name}: all ${OV_TAB_LABELS[ovTab]} enabled`, id: Toasts.genId() })
    }

    const disableAll = () => {
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = { ...list[idx].overrides }
        OV_GROUPS[ovTab].forEach(r => {
            newOverrides[r.key] = false
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        Toasts.show({ type: Toasts.Type.MESSAGE, message: `${label ? `${label} (${name})` : name}: all ${OV_TAB_LABELS[ovTab]} disabled`, id: Toasts.genId() })
    }

    const applyPreset = (preset: "stalker" | "lite" | "silent") => {
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        const dn = label ? `${label} (${name})` : name
        Toasts.show({ type: Toasts.Type.SUCCESS, message: `${dn}: ${preset} preset applied`, id: Toasts.genId() })
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = {}
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => {
                newOverrides[r.key] = null
            })
        })
        if (preset === "silent") {
            Object.keys(OV_GROUPS).forEach(g => {
                OV_GROUPS[g as OvTab].forEach(r => {
                    newOverrides[r.key] = false
                })
            })
            list[idx] = { ...list[idx], overrides: newOverrides }
            settings.store.watchlist = JSON.stringify(list)
            refresh()
            return
        }
        if (preset === "lite") {
            newOverrides["msgs"] = true
            newOverrides["deletes"] = true
            newOverrides["typing"] = true
            newOverrides["avatar"] = true
            newOverrides["voice"] = true
            newOverrides["status"] = true
            Object.keys(OV_GROUPS).forEach(g => {
                OV_GROUPS[g as OvTab].forEach(r => {
                    if (!["msgs","deletes","typing","avatar","voice","status"].includes(r.key)) {
                        newOverrides[r.key] = false
                    }
                })
            })
            list[idx] = { ...list[idx], overrides: newOverrides }
            settings.store.watchlist = JSON.stringify(list)
            refresh()
            return
        }
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => {
                newOverrides[r.key] = true
            })
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
    }

    const detectPreset = (): "stalker" | "lite" | "silent" | "custom" => {
        const allKeys: string[] = []
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => allKeys.push(r.key))
        })
        const ov = user.overrides as any
        const allFalse = allKeys.every(k => ov[k] === false)
        if (allFalse) return "silent"
        const allTrue = allKeys.every(k => ov[k] === true)
        if (allTrue) return "stalker"
        const liteKeys = ["msgs","deletes","typing","avatar","voice","status"]
        const isLite = liteKeys.every(k => ov[k] === true) &&
            allKeys.filter(k => !liteKeys.includes(k)).every(k => ov[k] === false)
        if (isLite) return "lite"
        return "custom"
    }

    const activePreset = detectPreset()

    return (
        <div className={`ur-row${expanded ? " open" : ""}`} style={{
            borderRadius: 18,
            marginBottom: 8,
            animationDelay: `${Math.min(index ?? 0, 10) * 28}ms`,
        }}>
            <div className="ur-row-surface" style={{
                background: expanded
                    ? "linear-gradient(135deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.03) 100%)"
                    : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                border: `1px solid ${isPinned ? C.brandLight + "60" : expanded ? C.bgEl : C.border}`,
                borderRadius: 18,
                overflow: "hidden",
            }}>
            <div className="ur-row-hover" onClick={() => setExp(!expanded)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer",
                borderRadius: expanded ? "18px 18px 0 0" : 18, transition: "background 100ms",
            }}>
                <div
                    role="button"
                    title={isPinned ? "unpin" : "pin to top"}
                    onClick={(e: any) => { e.stopPropagation(); onTogglePin?.() }}
                    className={`ur-row-pin${isPinned ? " ur-pin-pop" : ""}`}
                    key={isPinned ? "pinned" : "unpinned"}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: isPinned ? C.brandLight : C.muted,
                        opacity: isPinned ? 1 : 0.35,
                        flexShrink: 0,
                        cursor: "pointer",
                        transition: "opacity 120ms, color 120ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "1" }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = isPinned ? "1" : "0.35" }}
                >
                    {isPinned ? <ico.pin /> : <ico.pinOutline />}
                </div>
                <div style={{ position: "relative", flexShrink: 0, width: 44, height: 44 }}>
                    <img className="ur-row-avatar" src={av} style={{
                        width: 44, height: 44, borderRadius: "50%", display: "block",
                        // cuts a notch out of the avatar for the status badge to sit in,
                        // same as real discord — center matches the badge below
                        WebkitMaskImage: "radial-gradient(circle 8px at calc(100% - 7px) calc(100% - 7px), transparent 8px, #000 8.5px)",
                        maskImage: "radial-gradient(circle 8px at calc(100% - 7px) calc(100% - 7px), transparent 8px, #000 8.5px)",
                    }}
                        onError={(e: any) => { e.target.src = FALLBACK_AV }} />
                    <span className="ur-status-dot" style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        overflow: "hidden",
                        boxShadow: liveStatus === "online" ? "0 0 6px #23a55a80" : liveStatus === "idle" ? "0 0 6px #f0b23280" : liveStatus === "dnd" ? "0 0 6px #da373c80" : "none",
                    }}>
                        <StatusBadgeIcon status={liveStatus} />
                    </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: C.header }}>{name}</span>
                        {user.nick && (
                            <span className="ur-badge-in ur-badge-glass" style={{ background: `${C.brand}30`, color: C.white, fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.5, border: `1px solid ${C.brandLight}50`, boxShadow: `0 0 10px ${C.brand}30` }}>
                                {user.nick}
                            </span>
                        )}
                        {settings.store.globalPresetMode === "custom" && activePreset !== "custom" && (
                            <span className="ur-badge-glass" style={{
                                background: activePreset === "stalker" ? `${C.danger}25` : activePreset === "lite" ? `${C.brandLight}25` : `${C.muted}25`,
                                color: activePreset === "stalker" ? C.danger : activePreset === "lite" ? C.brandLight : C.muted,
                                fontSize: 9,
                                fontWeight: 800,
                                padding: "3px 8px",
                                borderRadius: 20,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                border: `1px solid ${activePreset === "stalker" ? `${C.danger}60` : activePreset === "lite" ? `${C.brandLight}60` : `${C.muted}60`}`,
                            }}>
                                {activePreset}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontFamily: "monospace", opacity: .7 }}>{user.id}</span>
                        <span>·</span>
                        <span title={exactTime(user.addedAt)}>{timeAgo(user.addedAt)}</span>
                    </div>
                </div>

                <div onClick={(e: any) => e.stopPropagation()} style={{ width: 80, flexShrink: 0 }}>
                    <LabelInput nick={nick} setNick={setNick} saveNick={saveNick} />
                </div>

                <div
                    onClick={(e: any) => {
                        e.stopPropagation();
                        const u = UserStore.getUser(user.id);
                        const name = displayName(u) || user.id;
                        const av = u ? avatarUrl(u.id, (u as any).avatar, 64) : avatarUrl(user.id, null, 64);
                        openModal(p => (
                            <Modal
                                {...p}
                                size="lg"
                                title={
                                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                                        <img src={av} style={{ width: 36, height: 36, borderRadius: "50%" }} />
                                        <div>
                                            <div style={{ fontSize: 16, fontWeight: 700, color: C.header }}>{name}</div>
                                            <div style={{ fontSize: 12, color: C.muted }}>Activity Log</div>
                                        </div>
                                    </div>
                                }
                                preview={<ActivityLogFooter userId={user.id} />}
                            >
                                <div className="ur-modal-in" style={{ padding: "0 12px" }}>
                                    <UserRadarActivityTab userId={user.id} />
                                </div>
                            </Modal>
                        ));
                    }}
                    title="Full Activity History"
                    className="ur-activity-btn"
                    style={{
                        padding: "5px 12px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        background: "rgba(255,255,255,0.05)",
                        color: C.text,
                        border: `1px solid ${C.border}`,
                        userSelect: "none",
                        letterSpacing: 0.3,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        height: 28,
                        boxSizing: "border-box",
                    }}
                >
                    <span style={{ display: "flex", alignItems: "center", opacity: 0.9 }}>
                        <ico.history />
                    </span>
                    <span>Activity</span>
                    <ActivityBadge userId={user.id} />
                </div>
                <div className={`ur-row-chevron${expanded ? " open" : ""}`}>
                    <ico.chevron />
                </div>

                <div onClick={(e: any) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    {[
                        { title: "copy id",       icon: copied ? <ico.check /> : <ico.copy />, color: copied ? C.green : C.muted, action: copyId },
                        { title: "open profile",  icon: <ico.external />,                       color: C.muted,                   action: () => openUserProfile(user.id) },
                        { title: "remove",        icon: <ico.trash />,                          color: C.red,                     action: onRemove },
                    ].map(btn => (
                        <div key={btn.title} role="button" tabIndex={0} title={btn.title}
                            className="ur-icon-btn"
                            onClick={btn.action}
                            onKeyDown={(e: any) => { if (e.key === "Enter") btn.action() }}
                            style={{ color: btn.color, cursor: "pointer", padding: 6, borderRadius: 6, display: "flex", alignItems: "center" }}
                            onMouseEnter={e => (e.currentTarget.style.background = btn.title === "remove" ? "rgba(218,55,60,0.12)" : C.hov)}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                            {btn.icon}
                        </div>
                    ))}
                </div>
            </div>

            <div className={`ur-expand${expanded ? " open" : ""}`}>
                <div>
                    <div style={{ padding: "20px 16px 24px", borderTop: "1px solid rgba(255,255,255,0.04)", background: "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.14) 100%)" }}>
                        <div className="ur-glass" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, marginBottom: 18, background: "rgba(0,0,0,0.35)", padding: 4, borderRadius: 24, border: "1px solid rgba(255,255,255,0.06)", width: "fit-content", minWidth: 300, position: "relative" }}>
                            <div style={{
                                position: "absolute",
                                top: 4,
                                bottom: 4,
                                left: 4,
                                width: "calc((100% - 8px) / 3)",
                                transform: `translateX(${["messages", "presence", "profile"].indexOf(ovTab) * 100}%)`,
                                background: "linear-gradient(135deg, #5865f2 0%, #7289da 100%)",
                                borderRadius: 20,
                                boxShadow: "0 2px 12px rgba(88,101,242,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
                                border: "1px solid rgba(255,255,255,0.15)",
                                transition: "transform 300ms cubic-bezier(0.34,1.2,0.4,1)",
                                pointerEvents: "none",
                                boxSizing: "border-box",
                                zIndex: 1,
                            }} />
                            {(["messages", "presence", "profile"] as OvTab[]).map(tab => {
                                const TabIcon = OV_TAB_ICONS[tab]
                                const active = ovTab === tab
                                return (
                                    <div key={tab} className="ur-tab-btn" onClick={() => setOvTab(tab)} style={{
                                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                        padding: "6px 14px", borderRadius: 20,
                                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                                        color: active ? "#fff" : C.muted,
                                        position: "relative", zIndex: 2,
                                        userSelect: "none",
                                    }}
                                        onMouseEnter={e => { if (!active) { e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.07)" } }}
                                        onMouseLeave={e => { if (!active) { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent" } }}
                                    >
                                        <span style={{ opacity: active ? 1 : 0.6, display: "flex", transition: "opacity 200ms ease" }}><TabIcon /></span>
                                        {OV_TAB_LABELS[tab]}
                                    </div>
                                )
                            })}
                        </div>
                        <div style={{ marginBottom: 18 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>Quick presets</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                {([
                                    { key: "stalker" as const, label: "Stalker", desc: "Every event", color: "#f04747", glow: "#f0474740" },
                                    { key: "lite" as const,    label: "Lite",    desc: "Essentials only", color: C.brand, glow: "#5865f240" },
                                    { key: "silent" as const,  label: "Silent",  desc: "No pings", color: "#949ba4", glow: "#949ba420" },
                                ]).map(preset => {
                                    const isActive = activePreset === preset.key
                                    return (
                                        <div key={preset.key} className="ur-preset-card ur-glass" onClick={() => applyPreset(preset.key)} style={{
                                            flex: 1, cursor: "pointer", padding: "12px 14px", borderRadius: 18,
                                            background: isActive ? `linear-gradient(145deg, ${preset.color}22 0%, ${preset.color}0d 100%)` : "rgba(255,255,255,0.03)",
                                            border: `1px solid ${isActive ? preset.color + "70" : "rgba(255,255,255,0.06)"}`,
                                            boxShadow: isActive ? `0 0 20px ${preset.glow}, inset 0 1px 0 rgba(255,255,255,0.08)` : "inset 0 1px 0 rgba(255,255,255,0.04)",
                                            transition: "all 220ms cubic-bezier(0.4,0,0.2,1)",
                                            backdropFilter: "blur(8px)",
                                        }}
                                            onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)" } }}
                                            onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)" } }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: preset.color, boxShadow: isActive ? `0 0 8px ${preset.color}` : "none", flexShrink: 0, transition: "box-shadow 220ms" }} />
                                                <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? preset.color : C.text, transition: "color 220ms" }}>{preset.label}</span>
                                            </div>
                                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>{preset.desc}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.25)" }}>Overrides</span>
                            <div style={{ flex: 1 }} />
                            <span onClick={enableAll} style={{ fontSize: 11, color: C.brandLight, cursor: "pointer", fontWeight: 600, marginRight: 12 }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = "0.7" }} onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}>Enable All</span>
                            <span onClick={disableAll} style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", cursor: "pointer", fontWeight: 600 }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = "0.7" }} onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}>Disable All</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {OV_GROUPS[ovTab].map(row => {
                                const isOn = isFeatureOn(user.id, row.key as any, row.gk)
                                const isOv = (user.overrides as any)[row.key] !== null && (user.overrides as any)[row.key] !== undefined
                                return (
                                    <div key={row.key}
                                        onClick={() => setOv(row.key as any, !isOn)}
                                        style={{
                                            background: isOn ? "linear-gradient(135deg, rgba(88,101,242,0.14) 0%, rgba(88,101,242,0.06) 100%)" : "rgba(255,255,255,0.025)",
                                            borderRadius: 16,
                                            border: `1px solid ${isOn && isOv ? "rgba(88,101,242,0.5)" : "rgba(255,255,255,0.06)"}`,
                                            boxShadow: isOn && isOv ? "0 0 16px rgba(88,101,242,0.18), inset 0 1px 0 rgba(255,255,255,0.08)" : "inset 0 1px 0 rgba(255,255,255,0.04)",
                                            padding: "10px 12px",
                                            cursor: "pointer",
                                            transition: "all 220ms cubic-bezier(0.4,0,0.2,1)",
                                            display: "flex", alignItems: "center", gap: 8,
                                            position: "relative", overflow: "hidden",
                                            backdropFilter: "blur(4px)",
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = isOn ? "linear-gradient(135deg, rgba(88,101,242,0.2) 0%, rgba(88,101,242,0.1) 100%)" : "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = isOn ? "rgba(88,101,242,0.6)" : "rgba(255,255,255,0.1)" }}
                                        onMouseLeave={e => { e.currentTarget.style.background = isOn ? "linear-gradient(135deg, rgba(88,101,242,0.14) 0%, rgba(88,101,242,0.06) 100%)" : "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = isOn && isOv ? "rgba(88,101,242,0.5)" : "rgba(255,255,255,0.06)" }}
                                    >
                                        {isOn && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "linear-gradient(180deg, #5865f2 0%, #7289da 100%)", borderRadius: "16px 0 0 16px", boxShadow: "0 0 10px #5865f2" }} />}
                                                <div style={{ color: isOn ? C.brand : C.muted, display: "flex", alignItems: "center", flexShrink: 0, position: "relative" }}>
                                                    {isOn && (
                                                        <span className="ur-pulse" style={{
                                                            position: "absolute",
                                                            top: -2, right: -2,
                                                            width: 6, height: 6,
                                                            borderRadius: "50%",
                                                            background: C.brand,
                                                            zIndex: 2,
                                                        }} />
                                                    )}
                                                    {row.key === "typing" && isOn ? (
                                                        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                                                            <span className="ur-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: C.brand, display: "inline-block" }} />
                                                            <span className="ur-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: C.brand, display: "inline-block" }} />
                                                            <span className="ur-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: C.brand, display: "inline-block" }} />
                                                        </div>
                                                    ) : <row.Icon />}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600, userSelect: "none", lineHeight: 1.3 }}>
                                                        {row.label}
                                                        {isOv && (
                                                            <span style={{ color: C.brandLight, marginLeft: 4, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>
                                                                custom
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: C.muted, userSelect: "none", marginTop: 1, lineHeight: 1.2 }}>
                                                        {row.desc}
                                                    </div>
                                                </div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <div
                                                        role="button"
                                                        tabIndex={0}
                                                        title="preview notification"
                                                        onClick={(e: any) => { e.stopPropagation(); previewNotification(user.id, row.key) }}
                                                        onKeyDown={(e: any) => { if (e.key === "Enter") { e.stopPropagation(); previewNotification(user.id, row.key) } }}
                                                        style={{
                                                            color: C.muted,
                                                            cursor: "pointer",
                                                            width: 26,
                                                            height: 26,
                                                            borderRadius: 20,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            transition: "all 150ms cubic-bezier(0.4,0,0.2,1)",
                                                            flexShrink: 0,
                                                            background: C.bg1,
                                                            border: `1px solid ${C.border}`,
                                                        }}
                                                        onMouseEnter={e => {
                                                            e.currentTarget.style.background = `${C.brand}18`
                                                            e.currentTarget.style.borderColor = `${C.brand}60`
                                                            e.currentTarget.style.color = C.brandLight
                                                            e.currentTarget.style.transform = "scale(1.08)"
                                                        }}
                                                        onMouseLeave={e => {
                                                            e.currentTarget.style.background = C.bg1
                                                            e.currentTarget.style.borderColor = C.border
                                                            e.currentTarget.style.color = C.muted
                                                            e.currentTarget.style.transform = "scale(1)"
                                                        }}
                                                    >
                                                        <ico.preview />
                                                    </div>
                                                    <Toggle on={isOn} onChange={v => setOv(row.key as any, v)} />
                                                    {isOv && (
                                                        <div role="button" tabIndex={0} title="reset to global"
                                                            onClick={(e: any) => { e.stopPropagation(); setOv(row.key as any, null) }}
                                                            onKeyDown={(e: any) => { if (e.key === "Enter") { e.stopPropagation(); setOv(row.key as any, null) } }}
                                                            style={{ color: C.muted, cursor: "pointer", fontSize: 10, padding: "2px 3px", borderRadius: 4, userSelect: "none" }}
                                                            onMouseEnter={e => (e.currentTarget.style.background = C.hov)}
                                                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                                        >
                                                            ↩
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                                    <span
                                        onClick={resetAll}
                                        style={{
                                            fontSize: 11,
                                            color: C.muted,
                                            cursor: "pointer",
                                            fontWeight: 500,
                                            transition: "color 150ms ease",
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = C.danger }}
                                        onMouseLeave={e => { e.currentTarget.style.color = C.muted }}
                                    >
                                        Reset to Default ↩
                                    </span>
                                </div>
                            </div>
                    </div>
                    </div>
                </div>
            </div>
    )
}

type SortMode = "az" | "date"

function createToolbarButton() {
    const btn = document.createElement("div")
    btn.id = "ur-toolbar-btn"
    btn.setAttribute("role", "button")
    btn.setAttribute("tabindex", "0")
    btn.setAttribute("aria-label", "UserRadar Watchlist")
    btn.title = "UserRadar Watchlist"
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
    btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;color:#b5bac1;margin:0 2px;border-radius:4px;transition:color 150ms ease,background 150ms ease;"
    btn.onclick = () => openModal(p => <WatchlistModal modalProps={p} />)
    btn.onmouseenter = () => { btn.style.color = "#ffffff"; btn.style.background = "rgba(255,255,255,0.1)" }
    btn.onmouseleave = () => { btn.style.color = "#b5bac1"; btn.style.background = "transparent" }
    return btn
}

let __urToolbarTimer: ReturnType<typeof setInterval> | null = null

function injectToolbarButton() {
    if (document.getElementById("ur-toolbar-btn")) return true
    const toolbar = document.querySelector('[class^="toolbar"], [class*="toolbar_"]') as HTMLElement
    if (!toolbar) return false
    const btn = createToolbarButton()
    const firstChild = toolbar.firstElementChild
    if (firstChild) {
        toolbar.insertBefore(btn, firstChild)
    } else {
        toolbar.appendChild(btn)
    }
    return true
}

function startToolbarObserver() {
    let attempts = 0
    const tryInject = () => {
        if (injectToolbarButton() || attempts++ > 30) {
            if (__urToolbarTimer) {
                clearInterval(__urToolbarTimer)
                __urToolbarTimer = null
            }
        }
    }
    tryInject()
    __urToolbarTimer = setInterval(tryInject, 500)
    const observer = new MutationObserver(() => {
        if (!document.getElementById("ur-toolbar-btn")) injectToolbarButton()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    ;(window as any).__urToolbarObserver = observer
}

function stopToolbarObserver() {
    if (__urToolbarTimer) {
        clearInterval(__urToolbarTimer)
        __urToolbarTimer = null
    }
    const observer = (window as any).__urToolbarObserver
    if (observer) {
        observer.disconnect()
        delete (window as any).__urToolbarObserver
    }
    const btn = document.getElementById("ur-toolbar-btn")
    if (btn) btn.remove()
}

function GlobalPresetControl({ refresh }: { refresh: () => void }) {
    const mode = settings.store.globalPresetMode || "custom"
    const presets = [
        { key: "custom",  label: "Custom",  desc: "Per-user control",         color: C.brand },
        { key: "stalker", label: "Stalker", desc: "Everything tracked",       color: C.danger },
        { key: "lite",    label: "Lite",    desc: "Essential tracking only",  color: C.brandLight },
        { key: "silent",  label: "Silent",  desc: "Log everything silently",    color: "#b5bac1" }, // lighter gray for better active contrast
    ]
    const activeIndex = presets.findIndex(p => p.key === mode)

    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 10 }}>
                Global Preset Mode
            </div>

            <div className="ur-glass" style={{
                display: "grid",
                gridTemplateColumns: `repeat(${presets.length}, 1fr)`,
                background: "rgba(0,0,0,0.35)",
                borderRadius: 22,
                border: `1px solid ${C.border}`,
                padding: 4,
                position: "relative",
            }}>
                <div style={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    left: 4,
                    width: `calc((100% - 8px) / ${presets.length})`,
                    transform: `translateX(${activeIndex * 100}%)`,
                    background: `linear-gradient(145deg, ${presets[activeIndex].color}2a 0%, ${presets[activeIndex].color}10 100%)`,
                    border: `1.5px solid ${presets[activeIndex].color}70`,
                    borderRadius: 18,
                    boxShadow: `0 0 20px ${presets[activeIndex].color}30, inset 0 1px 0 rgba(255,255,255,0.08)`,
                    transition: "transform 320ms cubic-bezier(0.34,1.2,0.4,1), background 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                    zIndex: 1,
                }} />

                {presets.map(p => {
                    const isActive = mode === p.key
                    return (
                        <div
                            key={p.key}
                            className="ur-tab-btn"
                            onClick={() => { settings.store.globalPresetMode = p.key; refresh() }}
                            style={{
                                padding: "12px 10px",
                                borderRadius: 18,
                                cursor: "pointer",
                                textAlign: "left",
                                position: "relative",
                                zIndex: 2,
                                userSelect: "none",
                            }}
                            onMouseEnter={e => {
                                if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)"
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color, boxShadow: isActive ? `0 0 8px ${p.color}` : "none", flexShrink: 0, transition: "box-shadow 220ms" }} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? p.color : C.subheader, transition: "color 200ms ease", whiteSpace: "nowrap" }}>
                                    {p.label}
                                </span>
                            </div>
                            <div style={{
                                fontSize: 10,
                                color: isActive ? C.text : C.muted,
                                lineHeight: 1.3,
                                transition: "color 200ms ease",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}>
                                {p.desc}
                            </div>
                        </div>
                    )
                })}
            </div>

            {mode !== "custom" && (
                <div style={{
                    marginTop: 10,
                    padding: "10px 14px",
                    background: C.bg1,
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    fontSize: 12,
                    color: C.muted,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}>
                    <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: presets[activeIndex].color,
                        flexShrink: 0,
                    }} />
                    <span>
                        All users follow the <b style={{ color: presets[activeIndex].color }}>{presets[activeIndex].label}</b> preset. Individual overrides are disabled. Switch to <b style={{ color: C.brand, cursor: "pointer" }} onClick={() => { settings.store.globalPresetMode = "custom"; refresh() }}>Custom</b> to configure per-user.
                    </span>
                </div>
            )}
        </div>
    )
}

function WatchlistModal({ modalProps }: { modalProps: any }) {
    React.useEffect(() => { injectStyles() }, [])

    const [users, setUsers]       = React.useState<WatchedUser[]>(() => { try { return getWatchlist(settings) } catch { return [] } })
    const [query, setQuery]       = React.useState("")
    const [sort,  setSort]        = React.useState<SortMode>("date")
    const [expandedId, setExpandedId] = React.useState<string | null>(null)
    const [pinned, setPinned]     = React.useState<string[]>(() => getPinned())

    const refresh = () => { try { setUsers(getWatchlist(settings)) } catch { setUsers([]) } }

    const onTogglePin = (uid: string) => {
        togglePin(uid)
        setPinned(getPinned())
    }

    const shown = React.useMemo(() => {
        let list = users.filter(u => {
            if (!query.trim()) return true
            const q  = query.toLowerCase()
            const du = UserStore.getUser(u.id)
            return [displayName(du), u.nick ?? "", u.id].join(" ").toLowerCase().includes(q)
        })
        const sorted = sort === "az"
            ? [...list].sort((a, b) => (displayName(UserStore.getUser(a.id)) || a.id).localeCompare(displayName(UserStore.getUser(b.id)) || b.id))
            : [...list].sort((a, b) => b.addedAt - a.addedAt)
        // pinned users float to the top
        return [...sorted].sort((a, b) => {
            const ap = pinned.includes(a.id) ? 1 : 0
            const bp = pinned.includes(b.id) ? 1 : 0
            return bp - ap
        })
    }, [users, query, sort, pinned])

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={
                <div className="ur-fade-in" style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="ur-pulse" style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        background: C.bg2,
                        border: `1px solid ${C.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}>
                        <ico.eye />
                    </div>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>UserRadar</div>
                        <div style={{ fontSize: 12, color: C.muted }}>watchlist manager</div>
                    </div>
                </div>
            }
        >
            <div className="ur-modal-in">
                <div className="ur-scrollbar" style={{ padding: "0 16px", maxHeight: "60vh", overflowY: "auto" }}>
                    <AddUserSection onAdded={refresh} />

                    <div style={{ height: 1, background: C.border, margin: "18px 0" }} />

                    <GlobalPresetControl refresh={refresh} />

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader }}>
                            watchlist <span style={{ fontWeight: 500, color: C.muted }}>({users.length})</span>
                        </div>

                        <div role="button" tabIndex={0}
                            className="ur-chip"
                            onClick={() => setSort(s => s === "az" ? "date" : "az")}
                            title={sort === "az" ? "sort by date" : "sort a-z"}
                            style={{
                                display: "flex", alignItems: "center", gap: 4,
                                padding: "0 9px",
                                borderRadius: 20,
                                cursor: "pointer",
                                background: C.bg2,
                                border: `1px solid ${C.border}`,
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 600,
                                userSelect: "none",
                                height: 28,
                                boxSizing: "border-box",
                                overflow: "hidden",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = C.bgEl)}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                        >
                            {sort === "az" ? <ico.sortAz /> : <ico.sortDate />}
                            {sort === "az" ? "a-z" : "newest"}
                        </div>

                        <SearchInput query={query} setQuery={setQuery} />
                    </div>

                    {users.length === 0 && (
                        <div className="ur-fade-in" style={{ textAlign: "center", padding: "48px 0" }}>
                            <div className="ur-float" style={{ display: "flex", justifyContent: "center", marginBottom: 14, color: C.muted }}><ico.ghost /></div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: C.header }}>nobody here yet</div>
                            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>add someone above to start tracking them</div>
                        </div>
                    )}

                    {shown.length === 0 && users.length > 0 && (
                        <div className="ur-fade-in" style={{ textAlign: "center", padding: "32px 0", fontSize: 13, color: C.muted }}>
                            no results for "<b>{query}</b>"
                        </div>
                    )}

                    {shown.map((u, i) => (
                        <WatchedRow
                            key={u.id}
                            user={u}
                            index={i}
                            refresh={refresh}
                            expandedId={expandedId}
                            setExpandedId={setExpandedId}
                            onRemove={() => {
                                removeUser(settings, u.id)
                                purgeUserCaches(u.id)
                                if (settings.store.autoCleanupLogs) activityStore.clearLogs(u.id)
                                if (getPinned().includes(u.id)) onTogglePin(u.id)
                                refresh()
                            }}
                            isPinned={pinned.includes(u.id)}
                            onTogglePin={() => onTogglePin(u.id)}
                        />
                    ))}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={() => {
                                const input = document.createElement("input")
                                input.type = "file"
                                input.accept = ".json"
                                input.onchange = async (e: any) => {
                                    const file = e.target.files[0]
                                    if (!file) return
                                    try {
                                        const text = await file.text()
                                        const data = JSON.parse(text)
                                        if (!Array.isArray(data)) throw new Error("Invalid format")
                                        let added = 0
                                        let skipped = 0
                                        for (const u of data) {
                                            // must be a real snowflake
                                            const id = typeof u?.id === "string" ? u.id.trim() : ""
                                            if (!/^\d{17,20}$/.test(id)) { skipped++; continue }
                                            if (isWatched(settings, id)) continue
                                            const nick = typeof u?.nick === "string" ? u.nick.trim().slice(0, 50) : ""
                                            addUser(settings, id, nick)
                                            added++
                                        }
                                        refresh()
                                        Toasts.show({
                                            message: skipped > 0
                                                ? `Imported ${added} users, skipped ${skipped} invalid entries`
                                                : `Imported ${added} users to watchlist`,
                                            id: Toasts.genId(),
                                            type: Toasts.Type.SUCCESS,
                                        })
                                    } catch (err: any) {
                                        Toasts.show({
                                            message: `Import failed: ${err.message || "Invalid file"}`,
                                            id: Toasts.genId(),
                                            type: Toasts.Type.FAILURE,
                                        })
                                    }
                                }
                                input.click()
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: 20,
                                background: "rgba(255,255,255,0.045)",
                                border: `1px solid ${C.border}`,
                                color: C.text,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                            className="ur-footer-btn"
                        >
                            <ico.download />
                            Import
                        </button>
                        <button
                            onClick={() => {
                                const list = getWatchlist(settings)
                                if (list.length === 0) {
                                    Toasts.show({
                                        message: "Watchlist is empty",
                                        id: Toasts.genId(),
                                        type: Toasts.Type.FAILURE,
                                    })
                                    return
                                }
                                const data = JSON.stringify(list, null, 2)
                                const blob = new Blob([data], { type: "application/json" })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = url
                                a.download = `userradar_watchlist_${new Date().toISOString().slice(0,10)}.json`
                                a.click()
                                URL.revokeObjectURL(url)
                                Toasts.show({
                                    message: `Exported ${list.length} users`,
                                    id: Toasts.genId(),
                                    type: Toasts.Type.SUCCESS,
                                })
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: 20,
                                background: "rgba(255,255,255,0.045)",
                                border: `1px solid ${C.border}`,
                                color: C.text,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                            className="ur-footer-btn"
                        >
                            <ico.upload />
                            Export
                        </button>
                        <button
                            onClick={() => {
                                if (confirm("Clear all activity logs for ALL watched users? This cannot be undone.")) {
                                    activityStore.clearAll().then(() => {
                                        Toasts.show({
                                            message: "All activity logs cleared",
                                            id: Toasts.genId(),
                                            type: Toasts.Type.SUCCESS,
                                        })
                                    })
                                }
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: 20,
                                background: "rgba(218,55,60,0.08)",
                                border: `1px solid ${C.red}`,
                                color: C.red,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                            className="ur-footer-btn ur-footer-btn-danger"
                        >
                            <ico.clear />
                            Clear All Logs
                        </button>
                    </div>

                    <button
                        onClick={modalProps.onClose}
                        className="ur-footer-btn ur-footer-btn-primary"
                        style={{
                            borderRadius: 20, height: 32, padding: "0 18px",
                            background: "rgba(255,255,255,0.045)", color: C.text,
                            border: `1px solid ${C.border}`, fontSize: 13,
                            fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                        }}
                    >
                        close
                    </button>
                </div>
            </div>
        </Modal>
    )
}

// context menu patches

const userCtxPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user) return
    const isW = isWatched(settings, user.id)
    const idx = children.findIndex(c => c?.props?.id === "user-context-devmode-copy-id")
    children.splice(idx >= 0 ? idx + 1 : children.length, 0,
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="ur-watch"
                label={isW ? "Unwatch User" : "Watch User"}
                icon={isW ? CtxEyeOffIcon : CtxEyeIcon}
                action={() => {
                    if (isW) { removeUser(settings, user.id); purgeUserCaches(user.id); Toasts.show({ type: Toasts.Type.MESSAGE, message: `removed ${displayName(user)} from watchlist`, id: Toasts.genId() }) }
                    else { addUser(settings, user.id); fetchNewUserBaseline(user.id); Toasts.show({ type: Toasts.Type.SUCCESS, message: `added ${displayName(user)} to watchlist`, id: Toasts.genId() }) }
                }}

            />
            <Menu.MenuItem
                id="ur-config"
                label="Manage Watchlist"
                icon={CtxGearIcon}
                action={() => openModal(p => <WatchlistModal modalProps={p} />)}

            />
        </Menu.MenuGroup>
    )
}

const msgCtxPatch: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message?.author) return
    const isW = isWatched(settings, message.author.id)
    const idx = children.findIndex(c => c?.props?.id === "message-devmode-copy-id")
    children.splice(idx >= 0 ? idx + 1 : children.length, 0,
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="ur-msg-watch"
                label={isW ? "remove author from watchlist" : "add author to watchlist"}
                icon={isW ? CtxEyeOffIcon : CtxEyeIcon}
                action={() => {
                    if (isW) { removeUser(settings, message.author.id); purgeUserCaches(message.author.id); Toasts.show({ type: Toasts.Type.MESSAGE, message: `removed ${displayName(message.author)} from watchlist`, id: Toasts.genId() }) }
                    else { addUser(settings, message.author.id); fetchNewUserBaseline(message.author.id); Toasts.show({ type: Toasts.Type.SUCCESS, message: `added ${displayName(message.author)} to watchlist`, id: Toasts.genId() }) }
                }}

            />
        </Menu.MenuGroup>
    )
}

// the plugin itself

// DM toolbar — injects clock icon for tracked users

const HISTORY_SVG = `<svg aria-hidden="true" role="img" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`

function injectDMActivityButton() {
    const match = location.pathname.match(/\/channels\/@me\/(\d+)/)
    if (!match) return
    const channelId = match[1]

    const channel = ChannelStore.getChannel(channelId)
    if (!channel || channel.type !== 1) return

    const recipientId = channel.recipients?.[0]
    if (!recipientId) return
    if (!isWatched(settings, recipientId)) return

    // anchor on a known toolbar button by aria-label
    const knownButtonLabels = [
        'Start Voice Call',
        'Start Video Call',
        'Add Friends to DM',
        'Show Member List',
        'Threads',
        'Notification Settings',
        'Pinned Messages',
        'Search',
        'Inbox'
    ]

    let anchorBtn: Element | null = null
    for (const label of knownButtonLabels) {
        anchorBtn = document.querySelector(`[aria-label="${label}"]`)
        if (anchorBtn) break
    }

    // fallback: any visible toolbar-looking button up top
    if (!anchorBtn) {
        const header = document.querySelector('[class*="chat_"]') || document.querySelector('[class*="chatContent_"]')
        if (header) {
            const buttons = header.querySelectorAll('[role="button"]')
            for (const btn of buttons) {
                const rect = btn.getBoundingClientRect()
                if (rect.width > 20 && rect.height > 20 && rect.top < 100) {
                    anchorBtn = btn
                    break
                }
            }
        }
    }

    if (!anchorBtn) return

    const toolbar = anchorBtn.parentElement
    if (!toolbar) return
    if (toolbar.querySelector('.ur-dm-activity-btn')) return

    const btn = document.createElement('div')
    btn.className = 'ur-dm-activity-btn'
    btn.setAttribute('role', 'button')
    btn.setAttribute('tabindex', '0')
    btn.setAttribute('aria-label', 'Track User History')
    btn.title = 'Track User History'
    btn.innerHTML = HISTORY_SVG
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;color:#b5bac1;border-radius:4px;transition:color 150ms ease,background 150ms ease;flex-shrink:0;'
    btn.onmouseenter = () => { btn.style.color = '#ffffff'; btn.style.background = 'rgba(255,255,255,0.1)' }
    btn.onmouseleave = () => { btn.style.color = '#b5bac1'; btn.style.background = 'transparent' }
    btn.onclick = (e) => {
        e.stopPropagation()
        e.preventDefault()
        const u = UserStore.getUser(recipientId)
        const name = displayName(u) || recipientId
        const av = u ? avatarUrl(u.id, (u as any).avatar, 64) : avatarUrl(recipientId, null, 64)
        openModal(p => (
            <Modal
                {...p}
                size="lg"
                title={
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                        <img src={av} style={{ width: 36, height: 36, borderRadius: "50%" }} />
                        <div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: C.header }}>{name}</div>
                            <div style={{ fontSize: 12, color: C.muted }}>Activity Log</div>
                        </div>
                    </div>
                }
                preview={<ActivityLogFooter userId={recipientId} />}
            >
                <div className="ur-modal-in" style={{ padding: "0 12px" }}>
                    <UserRadarActivityTab userId={recipientId} />
                </div>
            </Modal>
        ))
    }

    // prepend so it lands on the left
    toolbar.insertBefore(btn, toolbar.firstChild)
}

function startDMObserver() {
    injectDMActivityButton()
    const observer = new MutationObserver(() => injectDMActivityButton())
    observer.observe(document.body, { childList: true, subtree: true })
    ;(window as any).__urDmObserver = observer
}

function stopDMObserver() {
    const observer = (window as any).__urDmObserver
    if (observer) {
        observer.disconnect()
        delete (window as any).__urDmObserver
    }
    document.querySelectorAll('.ur-dm-activity-btn').forEach(el => el.remove())
}

async function handlePresenceUpdate(uid: string, u: any, isStartup: boolean) {
    const oldStatus = statusCache[uid]
    const newStatus = u.status
    const wasOffline = isOfflineStatus(oldStatus)
    const isOffline  = isOfflineStatus(newStatus)
    // compute once — used across multiple sub-blocks below
    const watchedUser = getWatchedUser(settings, uid)
    const discordUser = UserStore.getUser(uid)
    const dn = watchedUser?.nick ? `${watchedUser.nick} (${displayName(discordUser) || uid})` : displayName(discordUser) || uid
    const icon = discordUser ? avatarUrl(discordUser.id, (discordUser as any).avatar, 80) : undefined

    let sessionJustEnded = false

    // keeps a short window open so a duplicate presence event right after a
    // real transition doesn't get mistaken for a fresh, unrelated change
    const comingOnline = wasOffline && !isOffline
    const goingOffline = !wasOffline && isOffline
    const onlineStateChange = comingOnline || goingOffline
    const transitionKey = `transition:${uid}`
    if (onlineStateChange) _logDebounce[transitionKey] = Date.now()
    const recentlyTransitioned = onlineStateChange || (Date.now() - (_logDebounce[transitionKey] || 0) < 3000)

    if (!isOffline && !isStartup) {
        if (!statusSessionCache[uid]) {
            statusSessionCache[uid] = {
                startTime: Date.now(),
                startStatus: newStatus,
                changes: [{ status: newStatus, ts: Date.now() }],
                platforms: clientCache[uid] ? [{ platform: clientCache[uid]!, ts: Date.now() }] : [],
            }
        }
    }

    if (!isOffline && statusSessionCache[uid] && oldStatus !== undefined && oldStatus !== newStatus && !isStartup && !recentlyTransitioned) {
        statusSessionCache[uid]!.changes.push({ status: newStatus, ts: Date.now() })
        if (isFeatureOn(uid, "status", "globalStatus")) {

            notify({
                _uid: uid,
                title: `${dn} is now ${newStatus}`,
                body: `was: ${STATUS_LABEL[oldStatus] || oldStatus}`,
                icon,
                onClick: () => openUserProfile(uid),
            })
        }
    }

    if (isOffline && statusSessionCache[uid] && !isStartup) {
        const session = statusSessionCache[uid]!
        const duration = Date.now() - session.startTime
        const durStr = formatDuration(duration)
        const changes = session.changes

        const sessionPlatform = clientCache[uid] ? (CLIENT_LABEL_MAP[clientCache[uid]!] || clientCache[uid]) : undefined

        const statusTimeline = changes.map((ch, i) => {
            const prev = i > 0 ? changes[i - 1].status : session.startStatus
            if (ch.status === prev && i > 0) return null
            return {
                status: ch.status,
                emoji: STATUS_EMOJI_LOCAL[ch.status] || "⚫",
                label: STATUS_LABEL[ch.status] || ch.status,
                time: new Date(ch.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }),
                ts: ch.ts,
            }
        }).filter(Boolean)

        const platformTimeline = (session.platforms || []).map((pt: any, i: number) => {
            const prev = i > 0 ? session.platforms[i - 1].platform : null
            if (pt.platform === prev && i > 0) return null
            return {
                platform: pt.platform,
                time: new Date(pt.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }),
                ts: pt.ts,
            }
        }).filter(Boolean)

        if (isFeatureOn(uid, "status", "globalStatus")) {
            notify({
                _uid: uid,
                title: `${dn} went offline`,
                body: durStr ? `Online for ${durStr}` : "",
                icon,
                onClick: () => openUserProfile(uid),
            })
        }

        logUserActivity(uid, "session", "⏱️", durStr ? `Online session · ${durStr}` : "Online session", "", {
            metadata: {
                action: "status_session",
                startTime: session.startTime,
                endTime: Date.now(),
                duration: durStr || "< 1m",
                startStatus: session.startStatus,
                endStatus: newStatus,
                statusTimeline,
                platformTimeline,
                changeCount: changes.length,
                platform: sessionPlatform,
            }
        }).catch(() => {})

        statusSessionCache[uid] = null
        sessionJustEnded = true
    }

    if (oldStatus !== undefined && oldStatus !== newStatus && isFeatureOn(uid, "status", "globalStatus") && !isStartup && !statusSessionCache[uid] && !sessionJustEnded && !recentlyTransitioned) {

        const platLog = platformSuffixLog(uid)
        notify({
            _uid: uid,
            title: `${dn} is now ${newStatus}`,
            body: `was: ${STATUS_LABEL[oldStatus] || oldStatus}`,
            icon,
            onClick: () => openUserProfile(uid),
        })
        logActivity(uid, "status", STATUS_EMOJI_LOCAL[newStatus] || "⚫", `${STATUS_LABEL[oldStatus] || oldStatus} → ${STATUS_LABEL[newStatus] || newStatus}${platLog}`)
    }
    statusCache[uid] = newStatus

    const newClient = resolveClient((u as any).client_status ?? (u as any).clientStatus)
    const oldClient = clientCache[uid]
    if (oldClient !== undefined && newClient !== null && oldClient !== newClient && !isStartup && !recentlyTransitioned) {
        clientCache[uid] = newClient
        if (statusSessionCache[uid]) {
            statusSessionCache[uid]!.platforms.push({ platform: newClient, ts: Date.now() })
        }
        if (!statusSessionCache[uid] && isFeatureOn(uid, "status", "globalStatus")) {
            const allClients = resolveAllClients((u as any).client_status ?? (u as any).clientStatus)
            const clientLabel = allClients.length > 1 ? allClients.join(" + ") : newClient
            const emoji = CLIENT_EMOJI[newClient] || "📡"
            const oldEmoji = oldClient ? (CLIENT_EMOJI[oldClient] || "📡") : ""
            logActivity(uid, "status", emoji, `${oldClient ? `${oldEmoji} ${oldClient} → ` : ""}${emoji} ${clientLabel}`)
        }
    } else if (newClient !== null) {
        clientCache[uid] = newClient
    }

    const actKeyOf = (a: any) => a.type === 2
        ? `2\x00${a.name}\x00${a.details || ""}\x00${a.state || ""}`
        : `${a.type}\x00${a.name}`
    // spotify's very first presence tick sometimes has no details/state yet (track
    // metadata hasn't loaded) — tracking that empty tick then the real one right after
    // was making 2 cards + 2 notifs for the same song. skip the empty one entirely.
    const rawActs = (u.activities || []).filter((a: any) => a.type !== 4 && !(a.type === 2 && !a.details))
    const newActKeys = rawActs.map(actKeyOf)
    const oldActKeys: string[] = activityCache[uid] || []
    activityCache[uid] = newActKeys

    if (isFeatureOn(uid, "activity", "globalActivity") && !isStartup) {
        const actPlatform = clientCache[uid] ? (CLIENT_LABEL_MAP[clientCache[uid]!] || clientCache[uid]) : undefined
        const avatarIcon = icon

        // grab every field discord actually sends, exactly as it sends it
        const captureFullMeta = (act: any) => ({
            applicationId: act.application_id ?? act.applicationId ?? undefined,
            flags: act.flags ?? undefined,
            sessionId: act.session_id ?? act.sessionId ?? undefined,
            syncId: act.sync_id ?? act.syncId ?? undefined,
            party: act.party ? { id: act.party.id, size: act.party.size?.[0], max: act.party.size?.[1] } : undefined,
            smallImage: resolveActivityImage({ ...act, assets: { large_image: act.assets?.small_image ?? act.assets?.smallImage } }) || undefined,
            smallText: act.assets?.small_text ?? act.assets?.smallText ?? undefined,
            largeText: act.assets?.large_text ?? act.assets?.largeText ?? undefined,
            buttons: act.buttons ?? undefined,
            url: act.url ?? undefined,
        })

        const getSpotifyFields = (act: any) => {
            const song   = act.details || ""
            const artist = (act.state || "").replace(/;.*/, "").trim()
            const album  = act.assets?.large_text || act.assets?.largeText || ""
            const trackId = act.sync_id || ""
            const albumArtUrl = resolveActivityImage(act)
            return { song, artist, album, trackId, albumArtUrl }
        }

        const getGameIcon = (act: any) => resolveActivityImage(act)

        const closeListening = async (songName: string, artistName: string) => {
            const sk = sessionKey(uid, "listening", `${songName}:${artistName}`)
            const sess = activeSessions[sk]
            if (!sess) return
            const elapsed = Date.now() - sess.startTime
            const dur = elapsed > 60000 ? formatDuration(elapsed) : ""
            await activityStore.updateLog(uid, sess.logId, {
                type: "session",
                title: dur ? `${songName} · ${dur}` : songName,
                body: `${songName} by ${artistName}`,
                metadata: { 
                    ...sess.metadata, 
                    type: 2,
                    appName: sess.metadata?.appName || "Spotify",
                    action: "listening_session", 
                    endTime: Date.now(), 
                    duration: dur || "< 1m" 
                }
            })
            delete activeSessions[sk]
            scheduleSessionSave()
        }

        const closeActivity = async (sk: string, actName: string, type: number) => {
            const sess = activeSessions[sk]
            if (!sess) return
            const elapsed = Date.now() - sess.startTime
            const dur = elapsed > 60000 ? formatDuration(elapsed) : ""
            await activityStore.updateLog(uid, sess.logId, {
                type: "session",
                title: dur ? `${actName} · ${dur}` : actName,
                body: `${ACT_VERB[type] ?? "playing"} ${actName}`,
                metadata: { 
                    ...sess.metadata, 
                    appName: sess.metadata?.appName || actName,
                    action: "activity_session", 
                    endTime: Date.now(), 
                    duration: dur || "< 1m" 
                }
            })
            delete activeSessions[sk]
            scheduleSessionSave()
        }

        const openListening = async (act: any) => {
            const { song, artist, album, trackId, albumArtUrl } = getSpotifyFields(act)
            const sk = sessionKey(uid, "listening", `${song}:${artist}`)
            const title = song && artist ? `${song} — ${artist}` : song || act.name
            const body  = song && artist ? `${song} by ${artist}${album ? ` · ${album}` : ""}` : song || act.name
            notify({
                _uid: uid,
                title: `${dn} is listening to ${song || act.name}`,
                body,
                icon,
                onClick: () => openUserProfile(uid),
            })
            const entry = await logUserActivity(uid, "activity", "🎵", title, body, {
                metadata: { 
                    type: 2, 
                    appName: act.name || "Spotify",
                    song, 
                    artist, 
                    album, 
                    trackId,
                    albumArtUrl, 
                    platform: actPlatform, 
                    startTime: Date.now(),
                    startTimestamp: act.timestamps?.start,
                    endTimestamp: act.timestamps?.end,
                    action: "listening_start" 
                }
            })
            activeSessions[sk] = { 
                logId: entry.id, 
                startTime: Date.now(), 
                metadata: { 
                    type: 2,
                    appName: act.name || "Spotify",
                    song, 
                    artist, 
                    album, 
                    trackId,
                    albumArtUrl, 
                    platform: actPlatform,
                    startTimestamp: act.timestamps?.start,
                    endTimestamp: act.timestamps?.end
                } 
            }
            scheduleSessionSave()
        }

        const openActivity = async (act: any) => {
            const verb = ACT_VERB[act.type] ?? "playing"
            const emojiIcon = act.type === 1 ? "📺" : act.type === 3 ? "🎬" : act.type === 5 ? "🏆" : "🎮"
            const sk = sessionKey(uid, "activity", actKeyOf(act))
            let desc = act.name || ""
            let body = `${verb} ${act.name}`
            if (act.type === 1 && act.details) { desc = `${act.name}: ${act.details}`; body = `streaming ${act.details}` }
            else if (act.details) { desc = `${act.name} — ${act.details}`; body = `${act.name}: ${act.details}${act.state ? ` · ${act.state}` : ""}` }
            const title = act.details ? `${verb} ${act.name} — ${act.details}` : `${verb} ${act.name}`
            const appId = act.application_id || act.applicationId || ""
            let iconUrl = getGameIcon(act) || (appId ? appIconCache[appId] || "" : "")
            notify({
                _uid: uid,
                title: `${dn} is ${verb} ${act.name}`,
                body: desc,
                icon: avatarIcon,
                onClick: () => openUserProfile(uid),
            })
            const meta = {
                type: act.type,
                appName: act.name,
                name: act.name, details: act.details, state: act.state,
                platform: actPlatform,
                gameIconUrl: iconUrl,
                iconUrl,
                startTime: Date.now(),
                startTimestamp: act.timestamps?.start,
                endTimestamp: act.timestamps?.end,
                ...captureFullMeta(act),
            }
            const entry = await logUserActivity(uid, "activity", emojiIcon, title, body, {
                metadata: { ...meta, action: "activity_start" }
            })
            activeSessions[sk] = { logId: entry.id, startTime: Date.now(), metadata: meta }
            scheduleSessionSave()
            // no icon yet, app unconfirmed — fetch and patch the card once it's in
            if (!iconUrl && appId && appIconCache[appId] === undefined) {
                fetchAppIcon(appId).then(url => {
                    if (!url) return
                    const live = activeSessions[sk]
                    const patchedMeta = { ...meta, gameIconUrl: url, iconUrl: url }
                    if (live && live.logId === entry.id) live.metadata = patchedMeta
                    activityStore.updateLog(uid, entry.id, { metadata: patchedMeta }).catch(() => {})
                }).catch(() => {})
            }
        }

        for (const k of oldActKeys) {
            if (newActKeys.includes(k)) continue
            const [typeStr, ...parts] = k.split("\x00")
            const type = parseInt(typeStr)
            if (type === 2) {
                await closeListening(parts[1] || "", (parts[2] || "").trim())
            } else {
                const actName = parts.join("\x00")
                await closeActivity(sessionKey(uid, "activity", k), actName, type)
                notify({
                    _uid: uid,
                    title: `${dn} stopped ${ACT_VERB[type] ?? "playing"} ${actName}`,
                    body: "",
                    icon: avatarIcon,
                    onClick: () => openUserProfile(uid),
                })
            }
        }
        for (let idx = 0; idx < rawActs.length; idx++) {
            if (oldActKeys.includes(newActKeys[idx])) continue
            const act = rawActs[idx]
            if (act.type === 2) await openListening(act)
            else await openActivity(act)
        }
    }

    // custom text status (activity type 4) tracking
    if (isFeatureOn(uid, "profile", "globalProfile") && !isStartup) {
        const customAct = (u.activities || []).find((a: any) => a.type === 4) ?? null
        const newCustomStatus = customAct
            ? [customAct.emoji?.name, customAct.state].filter(Boolean).join(" ") || null
            : null
        const oldCustomStatus = customStatusCache[uid]

        // skip whenever either side of this tick is offline/invisible — multi-tick
        // reconnect sequences can outlast a fixed timer, so check live state instead
        const statusUnstable = isOffline || wasOffline || recentlyTransitioned

        if (statusUnstable) {
            // leave cache alone so the next real change compares right
        } else if (oldCustomStatus !== undefined && oldCustomStatus !== newCustomStatus && newCustomStatus === null) {
            // hold off — a disconnect blip fixes itself in ~2s
            const holdKey = `cs-hold:${uid}`
            _logDebounce[holdKey] = Date.now()
            setTimeout(() => {
                if (!pluginActive) return
                if (customStatusCache[uid] !== oldCustomStatus) return // something else already changed it
                if (Date.now() - (_logDebounce[holdKey] || 0) < 1900) return // a newer hold superseded this one
                if (isOfflineStatus(statusCache[uid])) return // they're offline now, definitely a disconnect
                customStatusCache[uid] = null
                notify({
                    _uid: uid,
                    title: `${dn} changed their status`,
                    body: "removed custom status",
                    icon,
                    onClick: () => openUserProfile(uid),
                })
                logUserActivity(uid, "custom_status", "💬", `changed their status`, "removed custom status",
                    { metadata: { before: oldCustomStatus, after: null } }
                ).catch(() => {})
            }, 2000)
        } else if (oldCustomStatus !== undefined && oldCustomStatus !== newCustomStatus) {
            customStatusCache[uid] = newCustomStatus

            const bodyText = newCustomStatus
                ? (oldCustomStatus ? `${oldCustomStatus} → ${newCustomStatus}` : newCustomStatus)
                : "removed custom status"
            // dedupe — discord fires this twice in a row sometimes
            const _ldk = `cs-change:${uid}`
            const _ldt = Date.now()
            if (!_logDebounce[_ldk] || _ldt - _logDebounce[_ldk] > 2000) {
                _logDebounce[_ldk] = _ldt
                notify({
                    _uid: uid,
                    title: `${dn} changed their status`,
                    body: bodyText,
                    icon,
                    onClick: () => openUserProfile(uid),
                })
                logUserActivity(uid, "custom_status", "💬",
                    `changed their status`,
                    bodyText,
                    { metadata: { before: oldCustomStatus, after: newCustomStatus } }
                ).catch(() => {})
            }
        } else {
            // unchanged or first-seen — just refresh the cache
            customStatusCache[uid] = newCustomStatus
        }
    }
}

export default definePlugin({
    name: "UserRadar",
    description: "track watched users and get notified on messages, edits, deletes, typing, profile/avatar changes, voice, status, activity, and server joins",
    authors: [{ name: "k1ng_op", id: 641266820187160576n }],
    settings,

    start() {
        addContextMenuPatch("user-context", userCtxPatch)
        addContextMenuPatch("message", msgCtxPatch)
        if (settings.store.showToolbarIcon) startToolbarObserver()
        startDMObserver()

        activityStore.load().catch(() => {})

        // pre-populate caches so the first event isn't mistaken for a join
        try {
            const vsMod    = findByProps("getVoiceStateForUser")
            const presMod  = findByProps("getStatus", "getActivities")

            for (const wu of getWatchlist(settings)) {
                try {
                    const vs = vsMod?.getVoiceStateForUser?.(wu.id)
                    vcCache[wu.id]     = vs?.channelId ?? null
                    cameraCache[wu.id] = vs?.selfVideo ?? false
                    streamCache[wu.id] = vs?.selfStream ?? false
                } catch { vcCache[wu.id] = null; cameraCache[wu.id] = false; streamCache[wu.id] = false }

                try {
                    const cs = presMod?.getClientStatus?.(wu.id)
                    if (cs) clientCache[wu.id] = resolveClient(cs as any)
                    else clientCache[wu.id] = null
                } catch { }

                // status + activity + custom status
                try {
                    const status = presMod?.getStatus?.(wu.id)
                    if (status) statusCache[wu.id] = status
                    const acts: any[] = presMod?.getActivities?.(wu.id) ?? []
                    activityCache[wu.id] = acts
                        .filter((a: any) => a.type !== 4)
                        .map((a: any) => a.type === 2
                            ? `2\x00${a.name}\x00${a.details || ""}\x00${a.state || ""}`
                            : `${a.type}\x00${a.name}`)
                    const customAct = acts.find((a: any) => a.type === 4) ?? null
                    customStatusCache[wu.id] = customAct
                        ? [customAct.emoji?.name, customAct.state].filter(Boolean).join(" ") || null
                        : null
                } catch { }

                // isMember() unreliable at startup, cooldown handles it
                guildCache[wu.id] = new Set()
            }
        } catch (e) { log.warn("snapshot failed", e) }

        // restore sessions that survived a restart, close out the ones that didn't
        loadActiveSessions().then(async saved => {
            if (!pluginActive) return
            for (const [sk, sess] of Object.entries(saved)) {
                const uid = sk.split("_")[0]
                const rest = sk.slice(uid.length + 1)
                if (!isWatched(settings, uid)) continue
                let stillLive = false
                if (rest.startsWith("voice_")) {
                    const channelId = rest.slice(6)
                    stillLive = vcCache[uid] != null && vcCache[uid] === channelId
                } else if (rest === "camera") {
                    stillLive = cameraCache[uid] === true && vcCache[uid] != null && vcCache[uid] === sess.channelId
                } else if (rest === "stream") {
                    stillLive = streamCache[uid] === true && vcCache[uid] != null && vcCache[uid] === sess.channelId
                } else if (rest.startsWith("activity_")) {
                    const key = rest.slice(9)
                    stillLive = (activityCache[uid] || []).includes(key)
                } else if (rest.startsWith("listening_")) {
                    const suffix = rest.slice(10)
                    stillLive = (activityCache[uid] || []).some(k => {
                        const parts = k.split("\x00")
                        if (parts[0] !== "2") return false
                        const details = parts[2] || ""
                        const artist = (parts[3] || "").replace(/;.*/, "").trim()
                        return `${details}:${artist}` === suffix
                    })
                }
                if (stillLive) {
                    activeSessions[sk] = sess
                } else {
                    try {
                        await activityStore.updateLog(uid, sess.logId, {
                            title: sess.metadata?.channel ? `Was in #${sess.metadata.channel}` : (sess.metadata?.appName ? `${sess.metadata.appName} · ended offline` : "Session ended"),
                            body: "ended while discord was closed — exact end time unknown",
                            metadata: { ...sess.metadata, duration: formatDuration(Date.now() - sess.startTime), startTime: sess.startTime, endTime: Date.now() },
                        })
                    } catch { }
                }
            }
            scheduleSessionSave()
        }).catch(() => {})

        // staggered so we don't get ratelimited
        const list = getWatchlist(settings)
        let i = 0
        const fetchNext = () => {
            if (!pluginActive || i >= list.length) return
            const wu = list[i++]
            RestAPI.get({
                url: `/users/${wu.id}/profile`,
                query: { with_mutual_guilds: true, with_mutual_friends_count: false },
            }).then((res: any) => {
                if (!pluginActive) return
                const data = camelize(res.body)
                profileCache[wu.id] = data
                if (Array.isArray(data.mutualGuilds)) {
                    guildCache[wu.id] = new Set(data.mutualGuilds.map((g: any) => g.id))
                }
                setTimeout(fetchNext, 800)
            }).catch(() => { if (pluginActive) setTimeout(fetchNext, 800) })
        }
        setTimeout(fetchNext, 500)  // let discord finish its own startup first

        pollTimer = setInterval(pollProfiles, 5 * 60 * 1000)
        _sessSaveInterval = setInterval(saveActiveSessions, 8000)
        pluginStartedAt = Date.now()
        pluginActive = true
    },

    stop() {
        pluginActive = false
        activityStore.flushSave().catch(() => {})
        saveActiveSessions().catch(() => {})
        if (_sessSaveInterval) { clearInterval(_sessSaveInterval); _sessSaveInterval = null }
        if (_sessSaveTimer) { clearTimeout(_sessSaveTimer); _sessSaveTimer = null }
        removeContextMenuPatch("user-context", userCtxPatch)
        removeContextMenuPatch("message", msgCtxPatch)
        stopToolbarObserver()
        stopDMObserver()
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        Object.keys(profileCache).forEach(k => delete profileCache[k])
        Object.keys(vcCache).forEach(k => delete vcCache[k])
        Object.keys(statusCache).forEach(k => delete statusCache[k])
        Object.keys(activityCache).forEach(k => delete activityCache[k])
        Object.keys(guildCache).forEach(k => delete guildCache[k])
        Object.keys(vcJoinTime).forEach(k => delete vcJoinTime[k])
        Object.keys(clientCache).forEach(k => delete clientCache[k])
        Object.keys(cameraCache).forEach(k => delete cameraCache[k])
        Object.keys(streamCache).forEach(k => delete streamCache[k])
        Object.keys(customStatusCache).forEach(k => delete customStatusCache[k])
        Object.keys(statusSessionCache).forEach(k => delete statusSessionCache[k])
        Object.keys(activeSessions).forEach(k => delete activeSessions[k])
        Object.keys(pendingTypingLog).forEach(k => delete pendingTypingLog[k])
        Object.keys(_notifDebounce).forEach(k => delete _notifDebounce[k])
        Object.keys(_logDebounce).forEach(k => delete _logDebounce[k])
        presenceDebounce.forEach(t => clearTimeout(t))
        presenceDebounce.clear()
        Object.keys(_albumColorCache).forEach(k => delete _albumColorCache[k])
        pluginStartedAt = 0
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message, channelId }: MsgCreateEvent) {
            if (optimistic || type !== "MESSAGE_CREATE") return
            const uid = message.author?.id
            if (!uid || !isWatched(settings, uid)) return
            const typingKey = `${uid}_${channelId}`
            const pendingTyping = pendingTypingLog[typingKey]
            if (pendingTyping) {
                delete pendingTypingLog[typingKey]
                if (Date.now() - pendingTyping.ts < TYPING_LOG_TTL_MS) {
                    activityStore.removeLog(uid, pendingTyping.logId).catch(() => {})
                }
            }
            if (isFeatureOn(uid, "msgs", "globalMsgs")) {
                const label = getWatchedUser(settings, uid)?.nick
                const name  = displayName(message.author)
                const dn    = label ? `${label} (${name})` : name
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
        },

        MESSAGE_UPDATE({ message }: MsgUpdateEvent) {
            const uid = message?.author?.id
            if (!uid || !isWatched(settings, uid)) return

            // edited_timestamp = real edit, not embed/pin/reaction
            if (!message.edited_timestamp) return

            if (!isFeatureOn(uid, "edits", "globalEdits")) return

            const label = getWatchedUser(settings, uid)?.nick
            const name  = displayName(message.author)
            const dn    = label ? `${label} (${name})` : name
            const ch    = ChannelStore.getChannel(message.channel_id)
            const gName = guildName(ch?.guild_id)
            const chName = ch?.name || "dm"

            const skipNotify = settings.store.skipCurrentChannel && getCurrentChannel()?.id === message.channel_id

            // MessageStore still holds the pre-edit content at this point
            const cached = MessageStore.getMessage(message.channel_id, message.id)
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

        },

        MESSAGE_DELETE({ id, channelId }: MsgDeleteEvent) {
            const store = tryLoadLoggedMsgs()
            // try discord cache, then message logger (both key formats)
            const msg = MessageStore.getMessage(channelId, id)
                ?? store?.[id]
                ?? (store as any)?.[channelId]?.[id]
            if (!msg?.author) return
            const uid = msg.author.id
            if (!isWatched(settings, uid)) return
            if (isFeatureOn(uid, "deletes", "globalDeletes")) {
                const label = getWatchedUser(settings, uid)?.nick
                const name  = displayName(msg.author)
                const dn    = label ? `${label} (${name})` : name
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
        },

        TYPING_START({ channelId, userId }: TypingEvent) {
            if (!isWatched(settings, userId)) return
            if (isFeatureOn(userId, "typing", "globalTyping")) {
                const label = getWatchedUser(settings, userId)?.nick
                const u     = UserStore.getUser(userId)
                const name  = displayName(u) || userId
                const dn    = label ? `${label} (${name})` : name
                const ch    = ChannelStore.getChannel(channelId)
                const gName = guildName(ch?.guild_id)
                const chName  = ch?.name || "dm"
                // for DMs, ch.name is null — show recipient context instead
                const location = gName
                    ? `${gName} · #${chName}`
                    : ch?.recipients?.length
                        ? "Direct Message"
                        : `#${chName}`
                const skipNotify = settings.store.skipCurrentChannel && getCurrentChannel()?.id === channelId
                // body format: "Server Name · #channel" or "Direct Message" for DMs
                if (!skipNotify) {
                    notify({
                        _uid: userId,
                        title: `${dn} is typing…`,
                        body: location + "",
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
                    pendingTypingLog[`${userId}_${channelId}`] = { logId: entry.id, ts: Date.now() }
                }).catch(() => {})
            }
        },

        async VOICE_STATE_UPDATES({ voiceStates }: VoiceStateEvent) {
            for (const vs of voiceStates || []) {
                const uid = vs.userId
                if (!isWatched(settings, uid)) continue
                const old = vcCache[uid]
                const now = vs.channelId || null
                const channelChanged = old !== now

                if (old === undefined) {
                    vcCache[uid] = now
                    cameraCache[uid] = vs.selfVideo ?? false
                    streamCache[uid] = vs.selfStream ?? false
                    continue
                }

                // update channel cache
                if (channelChanged) vcCache[uid] = now

                if (!isFeatureOn(uid, "voice", "globalVoice")) {
                    cameraCache[uid] = vs.selfVideo ?? false
                    streamCache[uid] = vs.selfStream ?? false
                    continue
                }

                const label = getWatchedUser(settings, uid)?.nick
                const u     = UserStore.getUser(uid)
                const name  = displayName(u) || uid
                const dn    = label ? `${label} (${name})` : name
                const ch    = now ? ChannelStore.getChannel(now) : (old ? ChannelStore.getChannel(old) : null)
                const chName = ch?.name || "unknown"

                if (!old && now) {
                    vcJoinTime[uid] = Date.now()
                    const guildNameVc = guildName(ch?.guild_id)
                    const sk = sessionKey(uid, "voice", now!)
                    notify({
                        _uid: uid,
                        title: `${dn} Joined Voice`,
                        body: (guildNameVc ? `${guildNameVc} · #${chName}` : `#${chName}`) + "",
                        icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                        onClick: () => jumpTo(ch?.guild_id, now!),
                    })
                    const vcMembers = settings.store.logVcMembers ? (() => {
                        try {
                            const vsMod = findByProps("getVoiceStatesForChannel")
                            const raw = vsMod?.getVoiceStatesForChannel?.(now!)
                            if (!raw) return []
                            // handle both plain object and Map
                            const states: any[] = raw instanceof Map ? [...raw.values()] : Object.values(raw)
                            return states
                                .filter((s: any) => s?.userId && s.userId !== uid)
                                .map((s: any) => { const m = UserStore.getUser(s.userId); return m ? (m.globalName || m.username) : s.userId })
                        } catch { return [] }
                    })() : []
                    const joinPlatform = clientCache[uid] ? CLIENT_LABEL_MAP[clientCache[uid]!] || clientCache[uid] : undefined
                    const entry = await logUserActivity(uid, "voice", "🎙️", `joined #${chName}`, joinPlatform ? `on ${joinPlatform}` : "", {
                        guildId: ch?.guild_id,
                        channelId: now!,
                        metadata: {
                            server: guildNameVc || "DM",
                            channel: chName,
                            action: "joined",
                            platform: joinPlatform,
                            members: vcMembers.length > 0 ? vcMembers : undefined,
                        }
                    })
                    // close any orphaned session sitting here first
                    const orphan = activeSessions[sk]
                    if (orphan && orphan.logId !== undefined) {
                        const orphanElapsed = Date.now() - orphan.startTime
                        activityStore.updateLog(uid, orphan.logId, {
                            title: orphan.metadata?.channel ? `Was in #${orphan.metadata.channel}` : "Session ended",
                            body: "",
                            metadata: { ...orphan.metadata, duration: formatDuration(orphanElapsed), startTime: orphan.startTime, endTime: Date.now() },
                        }).catch(() => {})
                    }
                    activeSessions[sk] = { logId: entry.id, startTime: Date.now(), channelId: now!, guildId: ch?.guild_id, metadata: { server: guildNameVc || "DM", channel: chName, platform: joinPlatform, members: vcMembers.length > 0 ? vcMembers : undefined } }
                    scheduleSessionSave()
                } else if (old && !now) {
                    const spent = vcJoinTime[uid] ? Date.now() - vcJoinTime[uid] : 0
                    delete vcJoinTime[uid]
                    const dur = spent > 60000 ? formatDuration(spent) : ""
                    const guildNameVcLeft = (ch ?? (old ? ChannelStore.getChannel(old) : null))
                    const guildNameVcLeftStr = guildName(guildNameVcLeft?.guild_id)
                    const sk = sessionKey(uid, "voice", old!)
                    const session = activeSessions[sk]

                    if (session) {
                        // Update the original join log with session info
                        await activityStore.updateLog(uid, session.logId, {
                            type: "session",
                            title: `In #${chName}`,
                            body: "",
                            metadata: {
                                ...session.metadata,
                                action: "voice_session",
                                startTime: session.startTime,
                                endTime: Date.now(),
                                duration: dur || "< 1m",
                                platform: session.metadata?.platform || (clientCache[uid] ? (CLIENT_LABEL_MAP[clientCache[uid]!] || clientCache[uid]) : undefined),
                                appName: session.metadata?.appName || guildNameVcLeftStr || "Discord",
                            }
                        })
                        delete activeSessions[sk]
                        scheduleSessionSave()
                        notify({
                            _uid: uid,
                            title: `${dn} Left Voice`,
                            body: guildNameVcLeftStr ? `${guildNameVcLeftStr} · #${chName}${dur ? " · " + dur : ""}` : `#${chName}${dur ? " · " + dur : ""}`,
                            icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                            onClick: () => openUserProfile(uid),
                        })
                    } else {
                        // No session found, log as separate leave event
                        notify({
                            _uid: uid,
                            title: `${dn} Left Voice`,
                            body: guildNameVcLeftStr ? `${guildNameVcLeftStr} · #${chName}` : `#${chName}`,
                            icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                            onClick: () => openUserProfile(uid),
                        })
                        logUserActivity(uid, "voice", "🎙️", `left #${chName}`, "", {
                            guildId: ch?.guild_id || guildNameVcLeft?.guild_id,
                            channelId: old!,
                            metadata: {
                                server: guildNameVcLeftStr || "DM",
                                channel: chName,
                                action: "left",
                            }
                        }).catch(() => {})
                    }
                } else if (old && now && old !== now) {
                    const oldCh = ChannelStore.getChannel(old)
                    const guildNameVcMove = guildName(ch?.guild_id)
                    notify({
                        _uid: uid,
                        title: `${dn} Moved Voice Channels`,
                        body: guildNameVcMove
                            ? `${guildNameVcMove}: #${oldCh?.name || "?"} → #${chName}`
                            : `#${oldCh?.name || "?"} → #${chName}`,
                        icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                        onClick: () => jumpTo(ch?.guild_id, now!),
                    })
                    logUserActivity(uid, "voice", "🎙️", `moved voice channels`, `${guildNameVcMove ? guildNameVcMove + " · " : ""}#${oldCh?.name || "?"} → #${chName}`, {
                        guildId: ch?.guild_id,
                        channelId: now!,
                        metadata: {
                            server: guildNameVcMove || "DM",
                            fromChannel: oldCh?.name || "?",
                            toChannel: chName,
                            action: "moved",
                        }
                    }).catch(() => {})
                }

                // runs on every VOICE_STATE_UPDATES regardless of channel change
                // discord sends a separate event when selfVideo/selfStream flips
                const currentCh = now ? ChannelStore.getChannel(now) : ch
                const currentChName = currentCh?.name || chName || "unknown"
                const currentChId = now || (old ?? undefined)
                const currentGuildId = currentCh?.guild_id

                if (now) {
                    // camera
                    const newCamera = vs.selfVideo ?? false
                    const oldCamera = cameraCache[uid] ?? false
                    if (oldCamera !== newCamera) {
                        cameraCache[uid] = newCamera
                        const camSk = sessionKey(uid, "camera")
                        if (newCamera) {
                            // Camera turned on - start session
                            notify({
                                _uid: uid,
                                title: `${dn} turned on camera`,
                                body: `in #${currentChName}`,
                                icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                                onClick: () => jumpTo(currentGuildId, currentChId),
                            })
                            const camPlatform = clientCache[uid] ? CLIENT_LABEL_MAP[clientCache[uid]!] || clientCache[uid] : undefined
                            logUserActivity(uid, "voice", "📷", `camera on`, "", {
                                guildId: currentGuildId,
                                channelId: currentChId,
                                metadata: {
                                    server: guildName(currentGuildId) || "DM",
                                    channel: currentChName,
                                    action: "camera_on",
                                    platform: camPlatform,
                                }
                            }).then(camEntry => {
                                activeSessions[camSk] = { logId: camEntry.id, startTime: Date.now(), channelId: currentChId, guildId: currentGuildId, metadata: { server: guildName(currentGuildId) || "DM", channel: currentChName, platform: camPlatform } }
                                scheduleSessionSave()
                            }).catch(e => log.warn("camera log failed", e))
                        } else {
                            const camSession = activeSessions[camSk]
                            const camSpent = camSession ? Date.now() - camSession.startTime : 0
                            const camDur = camSpent > 60000 ? formatDuration(camSpent) : ""
                            if (camSession) {
                                activityStore.updateLog(uid, camSession.logId, {
                                    type: "session",
                                    title: camDur ? `Camera on · ${camDur}` : `Camera on`,
                                    body: "",
                                    metadata: {
                                        ...camSession.metadata,
                                        action: "camera_session",
                                        startTime: camSession.startTime,
                                        endTime: Date.now(),
                                        duration: camDur || "< 1m",
                                    }
                                }).then(() => { delete activeSessions[camSk]; scheduleSessionSave() }).catch(() => { delete activeSessions[camSk]; scheduleSessionSave() })
                            }
                            notify({
                                _uid: uid,
                                title: `${dn} turned off camera`,
                                body: `in #${currentChName}${camDur ? " · " + camDur : ""}`,
                                icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                                onClick: () => jumpTo(currentGuildId, currentChId),
                            })
                        }
                    }

                    const newStream = vs.selfStream ?? false
                    const oldStream = streamCache[uid] ?? false
                    if (oldStream !== newStream) {
                        streamCache[uid] = newStream
                        const streamSk = sessionKey(uid, "stream")
                        if (newStream) {
                            notify({
                                _uid: uid,
                                title: `${dn} started screen sharing`,
                                body: `in #${currentChName}`,
                                icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                                onClick: () => jumpTo(currentGuildId, currentChId),
                            })
                            const streamPlatform = clientCache[uid] ? CLIENT_LABEL_MAP[clientCache[uid]!] || clientCache[uid] : undefined
                            logUserActivity(uid, "voice", "🖥️", `screen sharing`, "", {
                                guildId: currentGuildId,
                                channelId: currentChId,
                                metadata: {
                                    server: guildName(currentGuildId) || "DM",
                                    channel: currentChName,
                                    action: "stream_on",
                                    platform: streamPlatform,
                                }
                            }).then(streamEntry => {
                                activeSessions[streamSk] = { logId: streamEntry.id, startTime: Date.now(), channelId: currentChId, guildId: currentGuildId, metadata: { server: guildName(currentGuildId) || "DM", channel: currentChName, platform: streamPlatform } }
                                scheduleSessionSave()
                            }).catch(e => log.warn("stream log failed", e))
                        } else {
                                const streamSession = activeSessions[streamSk]
                            const streamSpent = streamSession ? Date.now() - streamSession.startTime : 0
                            const streamDur = streamSpent > 60000 ? formatDuration(streamSpent) : ""
                            if (streamSession) {
                                activityStore.updateLog(uid, streamSession.logId, {
                                    type: "session",
                                    title: streamDur ? `Screen sharing · ${streamDur}` : `Screen sharing`,
                                    body: "",
                                    metadata: {
                                        ...streamSession.metadata,
                                        action: "stream_session",
                                        startTime: streamSession.startTime,
                                        endTime: Date.now(),
                                        duration: streamDur || "< 1m",
                                    }
                                }).then(() => { delete activeSessions[streamSk]; scheduleSessionSave() }).catch(() => { delete activeSessions[streamSk]; scheduleSessionSave() })
                            }
                            notify({
                                _uid: uid,
                                title: `${dn} stopped screen sharing`,
                                body: `in #${currentChName}${streamDur ? " · " + streamDur : ""}`,
                                icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                                onClick: () => jumpTo(currentGuildId, currentChId),
                            })
                        }
                    }
                } else {
                    cameraCache[uid] = false
                    streamCache[uid] = false
                }
            }
        },

        async PRESENCE_UPDATES({ updates }: PresenceEvent) {
            const isStartup = Date.now() - pluginStartedAt < 15000
            for (const u of updates || []) {
                const uid = u.user?.id
                if (!uid || !isWatched(settings, uid)) continue

                // don't debounce offline/online flips or a quick blip gets swallowed
                const touchesOffline = isOfflineStatus(statusCache[uid]) || isOfflineStatus(u.status)
                if (touchesOffline) {
                    const pending = presenceDebounce.get(uid)
                    if (pending) { clearTimeout(pending); presenceDebounce.delete(uid) }
                    handlePresenceUpdate(uid, u, isStartup)
                    continue
                }

                // debounce — presence fires constantly for no reason
                const pending = presenceDebounce.get(uid)
                if (pending) clearTimeout(pending)
                presenceDebounce.set(uid, setTimeout(() => {
                    presenceDebounce.delete(uid)
                    handlePresenceUpdate(uid, u, isStartup)
                }, 300))
            }
        },

        USER_UPDATE({ user }: { user: any }) {
            if (!user?.id || !isWatched(settings, user.id)) return
            const relevant = ["username", "global_name", "globalName", "avatar", "discriminator", "pronouns"]
            const hasProfileChange = relevant.some(f => user[f] !== undefined)
            if (!hasProfileChange) return
            const old = profileCache[user.id]
            if (!old) {
                // empty at startup, seed from event
                profileCache[user.id] = { user: camelize(user) }
                return
            }
            checkProfileChanged(user.id, { ...old, user: { ...old.user, ...camelize(user) } })
        },

        USER_PROFILE_FETCH_SUCCESS(rawEvt: any) {
            if (!rawEvt?.user?.id) return
            profileCache[rawEvt.user.id] = camelize(rawEvt)
        },

        GUILD_MEMBER_ADD({ guildId, user }: GuildMemberEvent) {
            if (!user?.id || !isWatched(settings, user.id)) return
            if (!isFeatureOn(user.id, "joins", "globalJoins")) return

            if (!guildCache[user.id]) guildCache[user.id] = new Set()

            if (guildCache[user.id].has(guildId)) return
            guildCache[user.id].add(guildId)

            const gn    = guildName(guildId)
            const label = getWatchedUser(settings, user.id)?.nick
            const name  = displayName(user)
            const dn    = label ? `${label} (${name})` : name
            notify({
                _uid: user.id,
                title: `${dn} Joined a Server`,
                body: gn || "a server",
                icon: avatarUrl(user.id, user.avatar, 80),
                onClick: () => jumpTo(guildId),
            })
            logActivity(user.id, "join", "📥", `joined ${gn || guildId}`, guildId)
        },

        GUILD_MEMBER_REMOVE({ guildId, user }: GuildMemberEvent) {
            if (!user?.id || !isWatched(settings, user.id)) return
            if (!isFeatureOn(user.id, "joins", "globalJoins")) return

            if (!guildCache[user.id]) guildCache[user.id] = new Set()

            if (!guildCache[user.id].has(guildId)) return
            guildCache[user.id].delete(guildId)

            const gn    = guildName(guildId)
            const label = getWatchedUser(settings, user.id)?.nick
            const name  = displayName(user)
            const dn    = label ? `${label} (${name})` : name
            notify({
                _uid: user.id,
                title: `${dn} Left a Server`,
                body: gn || "a server",
                icon: avatarUrl(user.id, user.avatar, 80),
                onClick: () => jumpTo(guildId),
            })
            logActivity(user.id, "leave", "📤", `left ${gn || guildId}`, guildId)
        },
    },
})
