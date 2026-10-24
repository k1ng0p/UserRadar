import { settings } from "./settings"

export function getPinned(): string[] {
    try { return JSON.parse(settings.store.pinnedUsers || "[]") } catch { return [] }
}

export function togglePin(uid: string) {
    const cur = getPinned()
    const next = cur.includes(uid) ? cur.filter(id => id !== uid) : [...cur, uid]
    settings.store.pinnedUsers = JSON.stringify(next)
}

export function unpin(uid: string) {
    const cur = getPinned()
    if (cur.includes(uid)) settings.store.pinnedUsers = JSON.stringify(cur.filter(id => id !== uid))
}
