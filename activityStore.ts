import { DataStore } from "@api/index"

import { LEGACY_LOG_KEY, LOG_KEY_PREFIX, MAX_LOGS_HARD_CAP, SAVE_DELAY_MS } from "./constants"
import { settings } from "./settings"
import { log } from "./store"

export const IMAGE_HOSTS = new Set([
    "cdn.discordapp.com", "media.discordapp.net", "i.scdn.co",
    "static-cdn.jtvnw.net", "i.ytimg.com", "cdn.simpleicons.org",
])

export const IMAGE_META_KEYS = ["oldAvatar", "newAvatar", "albumArtUrl", "gameIconUrl", "iconUrl", "smallImage"]

export function safeImageUrl(v: unknown): string | undefined {
    if (typeof v !== "string") return
    try {
        const u = new URL(v)
        return u.protocol === "https:" && IMAGE_HOSTS.has(u.hostname) ? v : undefined
    } catch { }
}

// returns null if the entry is structurally broken
export function cleanImportedEntry(uid: string, e: any): ActivityEntry | null {
    if (typeof e !== "object" || e === null) return null
    if (typeof e.id !== "string" || typeof e.type !== "string") return null
    if (typeof e.ts !== "number" || !Number.isFinite(e.ts)) return null
    const str = (v: unknown) => typeof v === "string" ? v : ""
    const opt = (v: unknown) => typeof v === "string" ? v : undefined

    let metadata: Record<string, any> | undefined
    if (e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)) {
        const meta: Record<string, any> = { ...e.metadata }
        for (const k of IMAGE_META_KEYS) {
            if (!(k in meta)) continue
            const url = safeImageUrl(meta[k])
            if (url) meta[k] = url
            else delete meta[k]
        }
        metadata = meta
    }

    return {
        id: e.id, uid, ts: e.ts, type: e.type as ActivityType,
        icon: str(e.icon), title: str(e.title), body: str(e.body),
        guildId: opt(e.guildId), channelId: opt(e.channelId), msgId: opt(e.msgId),
        metadata,
    }
}

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

export class ActivityStore {
    private cache: Record<string, ActivityEntry[]> = {}
    private dirty = new Set<string>()
    private removed = new Set<string>()
    private loadPromise: Promise<void> | null = null
    private saveTimer: ReturnType<typeof setTimeout> | null = null
    // serializes writes so addLog/removeLog/updateLog never interleave
    private writeQueue: Promise<any> = Promise.resolve()

    load() {
        return this.loadPromise ??= this.readAll()
    }

    private async readAll() {
        try {
            const keys = (await DataStore.keys<string>()).filter(k => typeof k === "string" && k.startsWith(LOG_KEY_PREFIX))
            for (const k of keys) {
                try {
                    const raw = await DataStore.get(k)
                    if (raw) this.cache[k.slice(LOG_KEY_PREFIX.length)] = JSON.parse(raw)
                } catch (e) { log.error("skipping unreadable log", k, e) }
            }

            // one-time move from the old single-blob log
            const legacy = await DataStore.get(LEGACY_LOG_KEY)
            if (legacy) {
                const old = JSON.parse(legacy) as Record<string, ActivityEntry[]>
                for (const [uid, entries] of Object.entries(old)) {
                    if (this.cache[uid]) continue
                    this.cache[uid] = entries
                    this.dirty.add(uid)
                }
                if (await this.writeDirty()) await DataStore.del(LEGACY_LOG_KEY)
            }
        } catch (e) { log.error("failed to load activity log", e) }
    }

    private markDirty(uid: string) {
        this.removed.delete(uid)
        this.dirty.add(uid)
        this.scheduleSave()
    }

    // batches rapid writes into one save
    private scheduleSave() {
        if (this.saveTimer) return
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            this.writeDirty()
        }, SAVE_DELAY_MS)
    }

    async flushSave() {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
        await this.writeDirty()
    }

    private async writeDirty(): Promise<boolean> {
        const toWrite = [...this.dirty]
        const toDelete = [...this.removed]
        this.dirty.clear()
        this.removed.clear()
        try {
            for (const uid of toWrite) await DataStore.set(LOG_KEY_PREFIX + uid, JSON.stringify(this.cache[uid] ?? []))
            for (const uid of toDelete) await DataStore.del(LOG_KEY_PREFIX + uid)
            return true
        } catch (e) {
            log.error("failed to save activity log", e)
            toWrite.forEach(uid => this.dirty.add(uid))
            toDelete.forEach(uid => this.removed.add(uid))
            return false
        }
    }

    getLogs(uid: string): ActivityEntry[] {
        return this.cache[uid] || []
    }

    private enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(fn, fn)
        this.writeQueue = next.catch(() => {})
        return next
    }

    addLog(entry: Omit<ActivityEntry, "id">) {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[entry.uid] ??= []
            const fullEntry: ActivityEntry = {
                ...entry,
                id: `${entry.uid}_${entry.ts}_${Math.random().toString(36).slice(2, 8)}`,
            }
            logs.unshift(fullEntry)

            const rawMax = settings.store.maxLogsPerUser
            const max = rawMax > 0 ? Math.min(rawMax, MAX_LOGS_HARD_CAP) : MAX_LOGS_HARD_CAP
            if (logs.length > max) logs.length = max

            this.markDirty(entry.uid)
            return fullEntry
        }).catch(e => {
            log.error("failed to add log", e)
            throw e
        })
    }

    clearLogs(uid: string) {
        return this.enqueue(async () => {
            await this.load()
            delete this.cache[uid]
            this.dirty.delete(uid)
            this.removed.add(uid)
            await this.writeDirty()
        })
    }

    clearAll() {
        return this.enqueue(async () => {
            await this.load()
            for (const uid of Object.keys(this.cache)) this.removed.add(uid)
            this.cache = {}
            this.dirty.clear()
            await this.writeDirty()
            await DataStore.del(LEGACY_LOG_KEY)
        })
    }

    exportAll(): string {
        return JSON.stringify(this.cache, null, 2)
    }

    importAll(json: string) {
        return this.enqueue(async () => {
            try {
                const parsed = JSON.parse(json)
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false

                const cleaned: Record<string, ActivityEntry[]> = {}
                for (const [uid, entries] of Object.entries(parsed)) {
                    if (!/^\d{5,25}$/.test(uid) || !Array.isArray(entries)) return false
                    cleaned[uid] = []
                    for (const raw of entries) {
                        const e = cleanImportedEntry(uid, raw)
                        if (!e) return false
                        cleaned[uid].push(e)
                    }
                }

                await this.load()
                // merge by id, a category export must not wipe everything else
                for (const [uid, entries] of Object.entries(cleaned)) {
                    const logs = this.cache[uid] ??= []
                    const seen = new Set(logs.map(e => e.id))
                    for (const e of entries) if (!seen.has(e.id)) logs.push(e)
                    logs.sort((a, b) => b.ts - a.ts)
                    if (logs.length > MAX_LOGS_HARD_CAP) logs.length = MAX_LOGS_HARD_CAP
                    this.dirty.add(uid)
                    this.removed.delete(uid)
                }
                return await this.writeDirty()
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
            this.markDirty(uid)
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
            this.markDirty(uid)
            emitActivityRemove(uid, logId)
            return true
        })
    }

    // bulk delete, e.g. "remove all typing cards" for a user
    async removeLogsWhere(uid: string, predicate: (log: ActivityEntry) => boolean): Promise<number> {
        return this.enqueue(async () => {
            await this.load()
            const logs = this.cache[uid]
            if (!logs) return 0
            const toRemove = logs.filter(predicate)
            if (toRemove.length === 0) return 0
            this.cache[uid] = logs.filter(l => !predicate(l))
            this.markDirty(uid)
            toRemove.forEach(l => emitActivityRemove(uid, l.id))
            return toRemove.length
        })
    }
}

export const activityStore = new ActivityStore()

export const activityListeners = new Set<(uid: string, entry: ActivityEntry) => void>()

export function onActivityUpdate(cb: (uid: string, entry: ActivityEntry) => void) {
    activityListeners.add(cb)
    return () => activityListeners.delete(cb)
}

export function emitActivityUpdate(uid: string, entry: ActivityEntry) {
    activityListeners.forEach(cb => {
        try { cb(uid, entry) } catch (e) { log.error("activity listener failed", e) }
    })
}

export const activityRemoveListeners = new Set<(uid: string, logId: string) => void>()

export function onActivityRemove(cb: (uid: string, logId: string) => void) {
    activityRemoveListeners.add(cb)
    return () => activityRemoveListeners.delete(cb)
}

export function emitActivityRemove(uid: string, logId: string) {
    activityRemoveListeners.forEach(cb => {
        try { cb(uid, logId) } catch (e) { log.error("activity listener failed", e) }
    })
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

export function logActivity(uid: string, type: string, icon: string, title: string, body?: string, guildId?: string, channelId?: string, msgId?: string) {
    logUserActivity(uid, type as ActivityType, icon, title, body ?? title, { guildId, channelId, msgId }).catch(() => {})
}
