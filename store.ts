// store.ts — k1ng_op
// watchlist crud + misc helpers

import { DataStore } from "@api/index"
import { Logger } from "@utils/Logger"
import { WatchedUser } from "./types"

export const log = new Logger("UserRadar", "#a78bfa")

let corruptRaw: string | null = null

function parseList(raw: string): WatchedUser[] {
    if (!raw || raw.trim() === "") return []
    try {
        const data = JSON.parse(raw)
        if (!Array.isArray(data)) throw new Error("not an array")
        return data.filter(u => u && typeof u.id === "string") as WatchedUser[]
    } catch {
        log.error("watchlist json is unreadable, a backup is kept on the next save")
        corruptRaw = raw
        return []
    }
}

// mutating callers parse fresh from settings every time
export function getWatchlist(s: any): WatchedUser[] {
    return parseList(s.store.watchlist ?? "[]")
}

export function saveWatchlist(s: any, list: WatchedUser[]) {
    // never overwrite an unreadable watchlist without keeping a copy
    if (corruptRaw) {
        DataStore.set("UserRadar_Watchlist_Backup", corruptRaw).catch(() => { })
        corruptRaw = null
    }
    s.store.watchlist = JSON.stringify(list)
}

// read-only lookup, rebuilt only when the stored json changes.
// events fire for every user on discord so this has to be cheap
let indexRaw: string | null = null
let indexById = new Map<string, WatchedUser>()
function watchedIndex(s: any) {
    const raw = s.store.watchlist ?? "[]"
    if (raw !== indexRaw) {
        indexById = new Map(parseList(raw).map(u => [u.id, u]))
        indexRaw = raw
    }
    return indexById
}

export function isWatched(s: any, uid: string) {
    return watchedIndex(s).has(uid)
}

export function getWatchedUser(s: any, uid: string) {
    return watchedIndex(s).get(uid)
}

export function addUser(s: any, uid: string, nick = "") {
    const list = getWatchlist(s)
    if (list.some(u => u.id === uid)) return  // already there
    list.push({
        id: uid,
        nick,
        addedAt: Date.now(),
        overrides: {
            msgs: null, edits: null, deletes: null, typing: null,
            profile: null, avatar: null, voice: null, status: null,
            activity: null, joins: null,
        },
    })
    saveWatchlist(s, list)
    log.info("watching", uid)
}

export function removeUser(s: any, uid: string) {
    saveWatchlist(s, getWatchlist(s).filter(u => u.id !== uid))
    log.info("unwatched", uid)
}

export function patchUser(s: any, uid: string, patch: Partial<WatchedUser>) {
    saveWatchlist(s, getWatchlist(s).map(u => u.id === uid ? { ...u, ...patch } : u))
}

// null = "use global setting", true/false = override it
export function featureOn(
    s: any,
    uid: string,
    key: keyof WatchedUser["overrides"],
    globalKey: string
): boolean {
    const u = getWatchedUser(s, uid)
    if (!u) return false
    const ov = (u.overrides ?? {} as any)[key]
    if (ov !== null && ov !== undefined) return ov
    return s.store[globalKey] ?? false
}

// discord's api returns snake_case but everything in js is camelCase
// this just converts the whole object recursively so i don't have to think about it
export function camelize(obj: any): any {
    if (Array.isArray(obj)) return obj.map(camelize)
    if (obj !== null && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
                camelize(v),
            ])
        )
    }
    return obj
}

// true if notifications should be muted right now
export function inQuietHours(s: any): boolean {
    if (!s.store.quietHours) return false
    const now = new Date()
    const cur = now.getHours() * 60 + now.getMinutes()
    const parse = (t: string) => {
        const [h, m] = (t || "00:00").split(":").map(Number)
        return h * 60 + m
    }
    const start = parse(s.store.quietStart ?? "23:00")
    const end   = parse(s.store.quietEnd   ?? "07:00")
    if (Number.isNaN(start) || Number.isNaN(end)) return false
    // handle overnight ranges like 23:00-07:00
    return start > end
        ? cur >= start || cur < end
        : cur >= start && cur < end
}

export function displayName(user: any): string {
    if (!user) return "Unknown"
    return user.globalName ?? user.global_name ?? user.username ?? user.id ?? "Unknown"
}

export const STATUS_EMOJI: Record<string, string> = {
    online:    "🟢",
    idle:      "🌙",
    dnd:       "🔴",
    offline:   "⚫",
    invisible: "👻",
}
