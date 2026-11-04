import { findByProps } from "@webpack"
import { React } from "@webpack/common"

import { statusCache } from "../caches"

// one timer for every row instead of one per row
const subscribers = new Map<string, Set<(status: string) => void>>()
let timer: ReturnType<typeof setInterval> | null = null

function read(uid: string): string | undefined {
    try { return findByProps("getStatus", "getActivities")?.getStatus?.(uid) } catch { }
}

function tick() {
    for (const [uid, subs] of subscribers) {
        const s = read(uid)
        if (s) subs.forEach(cb => cb(s))
    }
}

export function useLiveStatus(uid: string): string {
    const [status, setStatus] = React.useState<string>(() => statusCache[uid] || "offline")

    React.useEffect(() => {
        let subs = subscribers.get(uid)
        if (!subs) subscribers.set(uid, subs = new Set())
        subs.add(setStatus)

        const now = read(uid)
        if (now) setStatus(now)
        if (!timer) timer = setInterval(tick, 4000)

        return () => {
            subs.delete(setStatus)
            if (subs.size === 0) subscribers.delete(uid)
            if (subscribers.size === 0 && timer) { clearInterval(timer); timer = null }
        }
    }, [uid])

    return status
}
