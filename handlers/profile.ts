import { openUserProfile } from "@utils/discord"
import { RestAPI, UserStore } from "@webpack/common"

import { logUserActivity } from "../activityStore"
import { guildCache, profileCache, seedUserCaches } from "../caches"
import { FIELD_NAME, PROFILE_ICON_MAP, PROFILE_TEXT, PROFILE_TYPE_MAP } from "../constants"
import { isFeatureOn, labeledName, notify } from "../notify"
import { runtime } from "../runtime"
import { sweepStaleSessions } from "../sessions"
import { settings } from "../settings"
import { camelize, getWatchlist, isWatched, log } from "../store"
import { avatarUrl, sleep } from "../utils"

export function checkProfileChanged(uid: string, fresh: any) {
    if (!isWatched(settings, uid)) return
    const old = profileCache[uid]
    if (!old) {
        profileCache[uid] = fresh
        return
    }

    // avatar — separate feature flag
    const oldAvatar = old.user?.avatar ?? old.user?.avatarUrl ?? null
    const newAvatar = fresh.user?.avatar ?? fresh.user?.avatarUrl ?? null
    if (newAvatar !== oldAvatar) {
        if (isFeatureOn(uid, "avatar", "globalAvatar")) {
            const dn = labeledName(uid, fresh.user)
            const oldAvatarUrl = oldAvatar ? avatarUrl(uid, oldAvatar, 256) : null
            const newAvatarUrl = newAvatar ? avatarUrl(uid, newAvatar, 256) : null
            notify({
                _uid: uid,
                title: newAvatar ? `${dn} changed their avatar` : `${dn} removed their avatar`,
                body: newAvatar ? "click to see new pfp" : "reset to default",
                icon: newAvatarUrl ?? undefined,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, "avatar", "🖼️",
                newAvatar ? `changed their avatar` : `removed their avatar`,
                "",
                { metadata: { oldAvatar: oldAvatarUrl, newAvatar: newAvatarUrl } }
            ).catch(() => {})
        }
    }

    // text profile fields — one log per changed field
    if (isFeatureOn(uid, "profile", "globalProfile")) {
        const u     = UserStore.getUser(uid)
        const dn = labeledName(uid, fresh.user)
        const icon  = u ? avatarUrl(u.id, (u as any).avatar) : undefined

        for (const f of PROFILE_TEXT) {
            // pronouns sits at root, not under user
            const rawOld = f === "pronouns"
                ? (old.pronouns ?? old.user?.pronouns ?? null)
                : (old.user?.[f] ?? null)
            const rawNew = f === "pronouns"
                ? (fresh.pronouns ?? fresh.user?.pronouns ?? null)
                : (fresh.user?.[f] ?? null)
            const oldVal = rawOld === "" ? null : rawOld
            const newVal = rawNew === "" ? null : rawNew
            if (oldVal === newVal) continue

            const fieldLabel = FIELD_NAME[f] ?? f
            const actType    = PROFILE_TYPE_MAP[f] ?? "profile"
            const actIcon    = PROFILE_ICON_MAP[f] ?? "👤"

            const notifyBody = newVal
                ? (oldVal ? `${oldVal} → ${newVal}` : newVal)
                : `removed ${fieldLabel}`

            notify({
                _uid: uid,
                title: `${dn} changed their ${fieldLabel}`,
                body: notifyBody,
                icon,
                onClick: () => openUserProfile(uid),
            })
            logUserActivity(uid, actType, actIcon,
                `changed their ${fieldLabel}`,
                "",  // shown via diff card instead
                { metadata: { field: f, before: oldVal, after: newVal } }
            ).catch(() => {})
        }
    }

    profileCache[uid] = fresh
}

let _pollRunning = false

// fetches profile/status/activity right away for one freshly-added user instead
// of waiting for the next 5-minute poll cycle to reach them
async function fetchProfileBaseline(uid: string) {
    const { body } = await RestAPI.get({
        url: `/users/${uid}/profile`,
        query: { with_mutual_guilds: true, with_mutual_friends_count: false },
    })
    const data = camelize(body)
    profileCache[uid] = data
    if (Array.isArray(data.mutualGuilds)) {
        guildCache[uid] = new Set(data.mutualGuilds.map((g: any) => g.id))
    }
}

// fetches profile/status/activity right away for one freshly added user
// instead of waiting for the next poll round
export async function fetchNewUserBaseline(uid: string) {
    if (!runtime.active) return
    seedUserCaches(uid)
    try {
        await fetchProfileBaseline(uid)
    } catch (e) { log.warn("baseline fetch failed for", uid, e) }
}

let warmRun = 0
// startup baseline for everyone on the list, spaced out so we don't get ratelimited
export async function warmProfiles() {
    const run = ++warmRun
    await sleep(500)  // let discord finish its own startup first
    for (const wu of getWatchlist(settings)) {
        if (!runtime.active || run !== warmRun) return
        try {
            await fetchProfileBaseline(wu.id)
        } catch (e) { log.warn("baseline fetch failed for", wu.id, e) }
        await sleep(800)
    }
}

export async function pollProfiles() {
    if (_pollRunning || !runtime.active) return
    _pollRunning = true
    try {
        await sweepStaleSessions()
        for (const wu of getWatchlist(settings)) {
            if (!runtime.active) break
            try {
                const { body } = await RestAPI.get({
                    url: `/users/${wu.id}/profile`,
                    query: { with_mutual_guilds: false, with_mutual_friends_count: false },
                })
                checkProfileChanged(wu.id, camelize(body))
            } catch (e: any) {
                log.warn("profile poll failed for", wu.id, e?.status ?? e)
                // ratelimited, skip the rest of this round
                if (e?.status === 429) break
            }
            await sleep(1500)
        }
    } finally {
        _pollRunning = false
    }
}

export function onUserUpdate({ user }: { user: any }) {
    if (!user?.id || !isWatched(settings, user.id)) return
    const relevant = ["username", "global_name", "globalName", "avatar", "discriminator", "pronouns"]
    const hasProfileChange = relevant.some(f => user[f] !== undefined)
    if (!hasProfileChange) return
    const old = profileCache[user.id]
    // no baseline yet, an event only carries part of the profile so it can't be one
    if (!old) return
    checkProfileChanged(user.id, { ...old, user: { ...old.user, ...camelize(user) } })
}

export function onUserProfileFetchSuccess(rawEvt: any) {
    const uid = rawEvt?.user?.id
    if (!uid || !isWatched(settings, uid)) return
    // compare before storing, otherwise a change seen here is never reported
    checkProfileChanged(uid, camelize(rawEvt))
}
