// store.ts
// keeping all the watched-user state in one place so i dont have to pass
// settings around everywhere

import { Logger } from "@utils/Logger"
import { WatchedUser } from "./types"

export const log = new Logger("UserRadar", "#a78bfa")

// ---------- settings key ----------
// settings.store.watchlist is a JSON string of WatchedUser[]
// (vencord doesnt have a list setting type so stringify it is)

function parse(raw: string): WatchedUser[] {
    if (!raw || raw.trim() === "") return []
    try {
        return JSON.parse(raw) as WatchedUser[]
    } catch {
        log.error("watchlist JSON was corrupted, resetting to []")
        return []
    }
}

// getter - always read fresh from settings so we dont get stale state
export function getWatchlist(settings: any): WatchedUser[] {
    return parse(settings.store.watchlist ?? "[]")
}

export function saveWatchlist(settings: any, list: WatchedUser[]) {
    settings.store.watchlist = JSON.stringify(list)
}

// ---------- helpers ----------

export function isWatched(settings: any, userId: string): boolean {
    return getWatchlist(settings).some(u => u.id === userId)
}

export function getWatchedUser(settings: any, userId: string): WatchedUser | undefined {
    return getWatchlist(settings).find(u => u.id === userId)
}

export function addUser(settings: any, userId: string, nick = "") {
    const list = getWatchlist(settings)
    if (list.some(u => u.id === userId)) return // already there
    list.push({
        id: userId,
        nick,
        addedAt: Date.now(),
        overrides: {
            msgs: null,
            edits: null,
            deletes: null,
            typing: null,
            profile: null,
            voice: null,
            status: null,
        },
    })
    saveWatchlist(settings, list)
    log.info("added user", userId)
}

export function removeUser(settings: any, userId: string) {
    const list = getWatchlist(settings).filter(u => u.id !== userId)
    saveWatchlist(settings, list)
    log.info("removed user", userId)
}

export function patchUser(settings: any, userId: string, patch: Partial<WatchedUser>) {
    const list = getWatchlist(settings).map(u =>
        u.id === userId ? { ...u, ...patch } : u
    )
    saveWatchlist(settings, list)
}

// checks if a specific feature is enabled for a user
// respects per-user override, falls back to the global toggle
export function featureOn(
    settings: any,
    userId: string,
    feature: keyof WatchedUser["overrides"],
    globalKey: string
): boolean {
    const u = getWatchedUser(settings, userId)
    if (!u) return false
    const override = u.overrides[feature]
    // null = not overridden, use global
    return override !== null ? override : (settings.store[globalKey] ?? true)
}

// util: snake_case → camelCase recursively
// needed because discord's API returns snake, but the JS objects use camel
export function camelize(obj: any): any {
    if (Array.isArray(obj)) return obj.map(camelize)
    if (obj && typeof obj === "object") {
        return Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
                camelize(v),
            ])
        )
    }
    return obj
}

// quiet hours check
// returns true if we should suppress notifications right now
export function inQuietHours(settings: any): boolean {
    if (!settings.store.quietHours) return false

    const now = new Date()
    const cur = now.getHours() * 60 + now.getMinutes()

    const toMins = (t: string) => {
        const [h, m] = t.split(":").map(Number)
        return h * 60 + m
    }

    const start = toMins(settings.store.quietStart ?? "22:00")
    const end   = toMins(settings.store.quietEnd   ?? "08:00")

    // handle overnight ranges (e.g. 22:00 – 08:00)
    return start > end
        ? cur >= start || cur < end
        : cur >= start && cur < end
}

// display name helper - prefers global_name over username
export function displayName(user: any): string {
    if (!user) return "Unknown"
    return user.globalName ?? user.global_name ?? user.username ?? user.id ?? "Unknown"
}

// status emoji mapping
export const STATUS_EMOJI: Record<string, string> = {
    online:    "🟢",
    idle:      "🌙",
    dnd:       "🔴",
    offline:   "⚫",
    invisible: "👻",
}
