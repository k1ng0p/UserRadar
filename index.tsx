// UserRadar by k1ng_op
// tracks msgs, edits, deletes, typing, profile/pfp, voice, status, activity, joins

import { addContextMenuPatch, removeContextMenuPatch } from "@api/ContextMenu"
import definePlugin from "@utils/types"

import { activityStore } from "./activityStore"
import { resetCaches, seedUserCaches } from "./caches"
import { msgCtxPatch, userCtxPatch } from "./contextMenu"
import { startDMObserver, stopDMObserver } from "./dom/dmButton"
import { startToolbarObserver, stopToolbarObserver } from "./dom/toolbar"
import { onGuildMemberAdd, onGuildMemberRemove } from "./handlers/guilds"
import { onMessageCreate, onMessageDelete, onMessageUpdate, onTypingStart } from "./handlers/messages"
import { onPresenceUpdates } from "./handlers/presence"
import { onUserProfileFetchSuccess, onUserUpdate, pollProfiles, warmProfiles } from "./handlers/profile"
import { onVoiceStateUpdates } from "./handlers/voice"
import { runtime } from "./runtime"
import { restoreSessions } from "./sessionRestore"
import { saveActiveSessions, startSessionSaver, stopSessionSaver } from "./sessions"
import { settings } from "./settings"
import { getWatchlist, log } from "./store"
import { injectStyles, removeStyles } from "./styles"

let pollTimer: ReturnType<typeof setInterval> | null = null

export default definePlugin({
    name: "UserRadar",
    description: "track watched users and get notified on messages, edits, deletes, typing, profile/avatar changes, voice, status, activity, and server joins",
    authors: [{ name: "k1ng_op", id: 641266820187160576n }],
    settings,

    start() {
        addContextMenuPatch("user-context", userCtxPatch)
        addContextMenuPatch("message", msgCtxPatch)
        if (settings.store.showToolbarIcon) startToolbarObserver()
        startDMObserver()
        injectStyles()

        activityStore.load().catch(e => log.error("failed to load activity log", e))

        for (const wu of getWatchlist(settings)) seedUserCaches(wu.id)

        runtime.startedAt = Date.now()
        runtime.active = true

        restoreSessions().catch(e => log.warn("failed to restore sessions", e))
        warmProfiles()

        pollTimer = setInterval(pollProfiles, 5 * 60 * 1000)
        startSessionSaver()
    },

    stop() {
        runtime.active = false
        activityStore.flushSave().catch(e => log.error("failed to save activity log", e))
        saveActiveSessions().catch(e => log.warn("failed to save sessions", e))
        stopSessionSaver()

        removeContextMenuPatch("user-context", userCtxPatch)
        removeContextMenuPatch("message", msgCtxPatch)
        stopToolbarObserver()
        stopDMObserver()
        removeStyles()

        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        resetCaches()
        runtime.startedAt = 0
    },

    flux: {
        MESSAGE_CREATE: onMessageCreate,
        MESSAGE_UPDATE: onMessageUpdate,
        MESSAGE_DELETE: onMessageDelete,
        TYPING_START: onTypingStart,
        VOICE_STATE_UPDATES: onVoiceStateUpdates,
        PRESENCE_UPDATES: onPresenceUpdates,
        USER_UPDATE: onUserUpdate,
        USER_PROFILE_FETCH_SUCCESS: onUserProfileFetchSuccess,
        GUILD_MEMBER_ADD: onGuildMemberAdd,
        GUILD_MEMBER_REMOVE: onGuildMemberRemove,
    },
})
