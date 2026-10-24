import { openUserProfile } from "@utils/discord"
import { UserStore } from "@webpack/common"

import { appIconCache, fetchAppIcon, resolveActivityImage } from "../activityMedia"
import { activityStore, logActivity, logUserActivity } from "../activityStore"
import { _logDebounce, activityCache, actKey, clientCache, customStatusCache, presenceDebounce, statusCache, statusSessionCache } from "../caches"
import { ACT_VERB, CLIENT_EMOJI, CLIENT_LABEL_MAP, isOfflineStatus, STATUS_EMOJI_LOCAL, STATUS_LABEL } from "../constants"
import { isFeatureOn, labeledName, notify, platformSuffixLog } from "../notify"
import { runtime } from "../runtime"
import { activeSessions, scheduleSessionSave, sessionKey, settleOpen, trackOpen } from "../sessions"
import { settings } from "../settings"
import { isWatched, log } from "../store"
import { PresenceEvent } from "../types"
import { avatarUrl, formatDuration, resolveAllClients, resolveClient } from "../utils"

const trackErr = (e: unknown) => log.error("activity tracking failed", e)

export async function handlePresenceUpdate(uid: string, u: any, isStartup: boolean) {
    const oldStatus = statusCache[uid]
    const newStatus = u.status
    const wasOffline = isOfflineStatus(oldStatus)
    const isOffline  = isOfflineStatus(newStatus)
    // compute once — used across multiple sub-blocks below
    const discordUser = UserStore.getUser(uid)
    const dn = labeledName(uid, discordUser)
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

        if (isFeatureOn(uid, "status", "globalStatus")) logUserActivity(uid, "session", "⏱️", durStr ? `Online session · ${durStr}` : "Online session", "", {
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

    // spotify's very first presence tick sometimes has no details/state yet (track
    // metadata hasn't loaded) — tracking that empty tick then the real one right after
    // was making 2 cards + 2 notifs for the same song. skip the empty one entirely.
    const rawActs = (u.activities || []).filter((a: any) => a.type !== 4 && !(a.type === 2 && !a.details))
    const newActKeys = rawActs.map(actKey)
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
            await settleOpen(sk)
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
            await settleOpen(sk)
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
            const entry = await trackOpen(sk, logUserActivity(uid, "activity", "🎵", title, body, {
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
            }))
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
            const sk = sessionKey(uid, "activity", actKey(act))
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
            const entry = await trackOpen(sk, logUserActivity(uid, "activity", emojiIcon, title, body, {
                metadata: { ...meta, action: "activity_start" }
            }))
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
                await closeListening(parts[1] || "", (parts[2] || "").trim()).catch(trackErr)
            } else {
                const actName = parts.join("\x00")
                await closeActivity(sessionKey(uid, "activity", k), actName, type).catch(trackErr)
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
            if (act.type === 2) await openListening(act).catch(trackErr)
            else await openActivity(act).catch(trackErr)
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
                if (!runtime.active) return
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

export async function onPresenceUpdates({ updates }: PresenceEvent) {
    const isStartup = Date.now() - runtime.startedAt < 15000
    for (const u of updates || []) {
        const uid = u.user?.id
        if (!uid || !isWatched(settings, uid)) continue

        // don't debounce offline/online flips or a quick blip gets swallowed
        const touchesOffline = isOfflineStatus(statusCache[uid]) || isOfflineStatus(u.status)
        if (touchesOffline) {
            const pending = presenceDebounce.get(uid)
            if (pending) { clearTimeout(pending); presenceDebounce.delete(uid) }
            handlePresenceUpdate(uid, u, isStartup).catch(e => log.error("presence update failed", e))
            continue
        }

        // debounce — presence fires constantly for no reason
        const pending = presenceDebounce.get(uid)
        if (pending) clearTimeout(pending)
        presenceDebounce.set(uid, setTimeout(() => {
            presenceDebounce.delete(uid)
            handlePresenceUpdate(uid, u, isStartup).catch(e => log.error("presence update failed", e))
        }, 300))
    }
}
