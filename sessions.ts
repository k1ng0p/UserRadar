import { DataStore } from "@api/index"

import { activityStore } from "./activityStore"
import { ACTIVE_SESSIONS_KEY, MAX_SESSION_AGE_MS } from "./constants"
import { log } from "./store"
import { formatDuration } from "./utils"

export function sessionKey(uid: string, type: string, channelId?: string): string {
    return channelId ? `${uid}_${type}_${channelId}` : `${uid}_${type}`
}

export type Session = { logId: string; startTime: number; channelId?: string; guildId?: string; metadata?: any }

export const activeSessions: Record<string, Session> = {}

let lastSavedSessions = ""

export async function saveActiveSessions() {
    const json = JSON.stringify(activeSessions)
    if (json === lastSavedSessions) return
    try {
        await DataStore.set(ACTIVE_SESSIONS_KEY, json)
        lastSavedSessions = json
    } catch (e) { log.warn("failed to save active sessions", e) }
}

export async function loadActiveSessions(): Promise<Record<string, Session>> {
    try {
        const data = await DataStore.get(ACTIVE_SESSIONS_KEY)
        return data ? JSON.parse(data) : {}
    } catch { return {} }
}

let _sessSaveTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSessionSave() {
    if (_sessSaveTimer) return
    _sessSaveTimer = setTimeout(() => { _sessSaveTimer = null; saveActiveSessions() }, 1000)
}

let sessSaveInterval: ReturnType<typeof setInterval> | null = null

export function startSessionSaver() {
    sessSaveInterval = setInterval(saveActiveSessions, 8000)
}

export function stopSessionSaver() {
    if (sessSaveInterval) { clearInterval(sessSaveInterval); sessSaveInterval = null }
    if (_sessSaveTimer) { clearTimeout(_sessSaveTimer); _sessSaveTimer = null }
}

// a session is only registered once its log card exists, so a fast close
// has to wait for the open to finish or it finds nothing and the card never closes
const pendingOpens = new Map<string, Promise<unknown>>()

export function trackOpen<T>(sk: string, p: Promise<T>): Promise<T> {
    pendingOpens.set(sk, p)
    const done = () => { if (pendingOpens.get(sk) === p) pendingOpens.delete(sk) }
    p.then(done, done)
    return p
}

export async function settleOpen(sk: string) {
    try { await pendingOpens.get(sk) } catch { }
}

export async function sweepStaleSessions() {
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
        } catch (e) { log.warn("failed to close stale session", e) }
    }
    if (touched) scheduleSessionSave()
}
