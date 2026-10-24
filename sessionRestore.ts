import { activityStore } from "./activityStore"
import { activityCache, cameraCache, streamCache, vcCache } from "./caches"
import { runtime } from "./runtime"
import { activeSessions, loadActiveSessions, scheduleSessionSave } from "./sessions"
import { settings } from "./settings"
import { isWatched, log } from "./store"
import { formatDuration } from "./utils"

function isStillLive(uid: string, rest: string, channelId?: string): boolean {
    if (rest.startsWith("voice_")) return vcCache[uid] != null && vcCache[uid] === rest.slice(6)
    if (rest === "camera") return cameraCache[uid] === true && vcCache[uid] != null && vcCache[uid] === channelId
    if (rest === "stream") return streamCache[uid] === true && vcCache[uid] != null && vcCache[uid] === channelId
    if (rest.startsWith("activity_")) return (activityCache[uid] || []).includes(rest.slice(9))
    if (rest.startsWith("listening_")) {
        const suffix = rest.slice(10)
        return (activityCache[uid] || []).some(k => {
            const parts = k.split("\x00")
            if (parts[0] !== "2") return false
            const artist = (parts[3] || "").replace(/;.*/, "").trim()
            return `${parts[2] || ""}:${artist}` === suffix
        })
    }
    return false
}

// restore sessions that survived a restart, close out the ones that didn't
export async function restoreSessions() {
    const saved = await loadActiveSessions()
    if (!runtime.active) return
    for (const [sk, sess] of Object.entries(saved)) {
        const uid = sk.split("_")[0]
        if (!isWatched(settings, uid)) continue

        if (isStillLive(uid, sk.slice(uid.length + 1), sess.channelId)) {
            activeSessions[sk] = sess
            continue
        }
        try {
            await activityStore.updateLog(uid, sess.logId, {
                title: sess.metadata?.channel
                    ? `Was in #${sess.metadata.channel}`
                    : sess.metadata?.appName ? `${sess.metadata.appName} · ended offline` : "Session ended",
                body: "ended while discord was closed, exact end time unknown",
                metadata: { ...sess.metadata, duration: formatDuration(Date.now() - sess.startTime), startTime: sess.startTime, endTime: Date.now() },
            })
        } catch (e) { log.warn("failed to close old session", e) }
    }
    scheduleSessionSave()
}
