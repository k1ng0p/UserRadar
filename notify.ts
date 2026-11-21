import { Notifications } from "@api/index"

import { _notifDebounce, clientCache } from "./caches"
import { CLIENT_EMOJI, CLIENT_LABEL_MAP, LITE_FEATURES } from "./constants"
import { settings } from "./settings"
import { displayName, featureOn, getWatchedUser, inQuietHours, isWatched, log } from "./store"
import { WatchedUser } from "./types"
import { trunc } from "./utils"

export function msgPreview(content: string, filename?: string) {
    if (!settings.store.showPreview) return "click to jump"
    return trunc(content || filename || "click to jump", settings.store.previewLen)
}

export function isFeatureOn(uid: string, userKey: keyof WatchedUser["overrides"], globalKey: string): boolean {
    if (!isWatched(settings, uid)) return false
    const mode = settings.store.globalPresetMode ?? "custom"
    // silent logs everything too, notify() is what mutes it
    if (mode === "stalker" || mode === "silent") return true
    if (mode === "lite") return LITE_FEATURES.includes(userKey)
    // custom and silent: silent only mutes notify(), logging follows the normal settings
    return featureOn(settings, uid, userKey, globalKey)
}

export function labeledName(uid: string, user: any): string {
    const nick = getWatchedUser(settings, uid)?.nick
    const name = displayName(user) || uid
    return nick ? `${nick} (${name})` : name
}

export function notify(opts: { title: string; body: string; icon?: string; onClick?: () => void; _uid?: string }) {
    if (inQuietHours(settings)) return
    if (settings.store.globalPresetMode === "silent") return
    if (opts._uid && getWatchedUser(settings, opts._uid)?.muted) return

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

export function platformSuffixLog(uid: string): string {
    const c = clientCache[uid]
    if (!c) return ""
    return ` · on ${CLIENT_EMOJI[c] || "📡"} ${CLIENT_LABEL_MAP[c] || c}`
}
