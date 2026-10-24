import { findByProps } from "@webpack"

export function trunc(s: string, max: number) {
    return max > 0 && s.length > max ? s.slice(0, max) + "…" : s
}

export function jumpTo(guildId?: string, channelId?: string, msgId?: string) {
    if (guildId)   findByProps("transitionToGuildSync")?.transitionToGuildSync(guildId)
    if (channelId) findByProps("selectChannel")?.selectChannel({ guildId: guildId ?? "@me", channelId, messageId: msgId })
}

export function avatarUrl(id: string, hash?: string | null, size = 80): string {
    try {
        if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=${size}`
        let i = 0
        try { i = Number((BigInt(id) >> 22n) % 6n) } catch { i = parseInt(id.slice(-4), 10) % 6 || 0 }
        return `https://cdn.discordapp.com/embed/avatars/${i}.png`
    } catch { return "https://cdn.discordapp.com/embed/avatars/0.png" }
}

export function guildName(guildId?: string | null): string | null {
    if (!guildId) return null
    return findByProps("getGuild")?.getGuild(guildId)?.name ?? null
}

export function resolveClient(cs?: Record<string, string> | null): string | null {
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
export function resolveAllClients(cs?: Record<string, string> | null): string[] {
    if (!cs) return []
    return Object.keys(cs).filter(k => cs[k])
}

export function timeAgo(ts: number): string {
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

export function exactTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", hour12: true })
}

export function decodeSnowflake(id: string) {
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

export function formatDuration(ms: number): string {
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

export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${alpha})`
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
