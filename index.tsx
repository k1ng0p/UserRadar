/*
 * UserRadar - a Vencord plugin by Mubashir
 *
 * get notified whenever someone you're watching does anything on discord
 * messages, edits, deletes, typing, profile changes, voice, status - all of it
 *
 * needs vc-message-logger-enhanced for delete tracking to work properly
 * without it deletes will only fire if discord still has the msg cached
 */

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu"
import { Notifications } from "@api/index"
import { definePluginSettings } from "@api/Settings"
import { getCurrentChannel, openUserProfile } from "@utils/discord"
import { openModal } from "@utils/modal"
import definePlugin, { OptionType } from "@utils/types"
import { findByProps } from "@webpack"
import {
    ChannelStore, Menu, MessageStore,
    React, RestAPI, Text, Toasts, UserStore
} from "@webpack/common"
import { Message } from "discord-types/general"

import {
    MsgCreateEvent, MsgDeleteEvent, MsgUpdateEvent,
    PresenceEvent, ProfileFetchEvent, ThreadCreateEvent,
    TypingEvent, VoiceStateEvent
} from "./types"

import {
    addUser, camelize, displayName, featureOn,
    getWatchedUser, getWatchlist, inQuietHours,
    isWatched, log, removeUser, STATUS_EMOJI
} from "./store"

import { WatchlistModal } from "./WatchlistModal"

// ---------- runtime state ----------
// (not in settings, just lives as long as the plugin is running)

// cache of last-fetched profile data per user id
// used to diff against and fire profile-change notifs
const profileCache: Record<string, ProfileFetchEvent> = {}

// last known voice channel id per user - null = not in vc
const vcCache: Record<string, string | null> = {}

// last known status per user
const statusCache: Record<string, string> = {}

// reference to loggedMessages from the logger plugin (may be undefined)
let loggedMsgs: Record<string, Message> | null = null

// background poll timer - refetches profiles every few minutes
// because discord never pushes bio/banner changes over websocket,
// we have to ask for them ourselves
let pollTimer: ReturnType<typeof setInterval> | null = null

// ---------- helper to lazy-load the logger plugin's message store ----------

async function tryLoadLoggedMsgs() {
    if (loggedMsgs) return loggedMsgs
    // it can be in either location depending on how vencord is set up
    for (const prefix of ["plugins", "userplugins"]) {
        try {
            // @ts-ignore dynamic import path
            const m = await import(`${prefix}/vc-message-logger-enhanced/LoggedMessageManager`)
            loggedMsgs = m.loggedMessages ?? null
            return loggedMsgs
        } catch { /* try next */ }
    }
    return null
}

// ---------- settings ----------

const settings = definePluginSettings({
    // internal - not shown in settings panel directly, managed by the modal
    watchlist: {
        type: OptionType.STRING,
        default: "[]",
        description: "Watched users list (JSON - managed by the UI below, don't edit manually)",
        hidden: true,
    },

    // global event toggles
    globalMsgs: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify on new messages",
    },
    globalEdits: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify on message edits",
    },
    globalDeletes: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify on message deletes (requires vc-message-logger-enhanced)",
    },
    globalTyping: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify when someone starts typing",
    },
    globalProfile: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify on profile changes (avatar, bio, banner, etc.)",
    },
    globalVoice: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Notify on voice channel joins / leaves / moves",
    },
    globalStatus: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Notify on status changes (can be noisy, off by default)",
    },

    // notification content
    showPreview: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show message content in notifications",
    },
    previewLen: {
        type: OptionType.NUMBER,
        default: 120,
        description: "Max chars to show in message preview (0 = no limit)",
    },

    // quiet hours
    quietHours: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Mute all notifications during a set time window",
    },
    quietStart: {
        type: OptionType.STRING,
        default: "23:00",
        description: "Quiet hours start time (24h, e.g. 23:00)",
    },
    quietEnd: {
        type: OptionType.STRING,
        default: "07:00",
        description: "Quiet hours end time (24h, e.g. 07:00)",
    },

    // misc
    skipCurrentChannel: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Don't notify if you're already looking at the same channel",
    },
    debugLog: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Print all tracked events to the console (for debugging)",
    },
})

// ---------- small helpers ----------

function truncate(s: string, max: number): string {
    if (max <= 0 || s.length <= max) return s
    return s.slice(0, max) + "…"
}

function msgPreview(content: string, filename?: string): string {
    if (!settings.store.showPreview) return "Click to jump"
    const base = content || filename || "Click to jump"
    return truncate(base, settings.store.previewLen)
}

function jumpTo(guildId?: string, channelId?: string, msgId?: string) {
    if (guildId) findByProps("transitionToGuildSync")?.transitionToGuildSync(guildId)
    if (channelId) findByProps("selectChannel")?.selectChannel({
        guildId: guildId ?? "@me",
        channelId,
        messageId: msgId,
    })
}

// in-app toast when discord is focused, OS notification when it's minimized/in background
// document.hasFocus() is the simplest reliable way to check this in electron
function push(opts: {
    title: string
    body: string
    icon?: string
    onClick?: () => void
}) {
    if (inQuietHours(settings)) return
    if (settings.store.debugLog) log.info(`notif: ${opts.title} — ${opts.body}`)

    if (document.hasFocus()) {
        // discord is open and in focus — use the in-app toast
        Notifications.showNotification({
            title: opts.title,
            body: opts.body,
            icon: opts.icon,
            onClick: opts.onClick,
        })
    } else {
        // discord is minimized or in background — use real OS notification
        try {
            const n = new window.Notification(opts.title, {
                body: opts.body,
                icon: opts.icon,
            })
            if (opts.onClick) {
                n.onclick = () => {
                    window.focus()
                    opts.onClick!()
                }
            }
        } catch (e) {
            // OS blocked it for some reason, fall back to in-app toast
            log.warn("OS Notification() failed, falling back to toast:", e)
            Notifications.showNotification({
                title: opts.title,
                body: opts.body,
                icon: opts.icon,
                onClick: opts.onClick,
            })
        }
    }
}

// ---------- profile change detection ----------
// extracted into its own function so both the background poll
// and the USER_PROFILE_FETCH_SUCCESS event can reuse it

const PROFILE_FIELDS = [
    "username", "globalName", "avatar",
    "bio", "banner", "bannerColor", "accentColor",
] as const

const FIELD_LABELS: Record<string, string> = {
    username:    "username",
    globalName:  "display name",
    avatar:      "avatar",
    bio:         "bio",
    banner:      "banner",
    bannerColor: "banner color",
    accentColor: "accent color",
}

function checkProfileChanged(uid: string, freshData: ProfileFetchEvent) {
    if (!isWatched(settings, uid)) return
    if (!featureOn(settings, uid, "profile", "globalProfile")) return

    const old = profileCache[uid]

    if (!old) {
        // first time - just store it, don't fire a notif
        profileCache[uid] = freshData
        return
    }

    const changed = PROFILE_FIELDS.filter(
        f => (freshData.user as any)[f] !== (old.user as any)[f]
    )

    if (changed.length === 0) return

    const u     = UserStore.getUser(uid)
    const name  = displayName(freshData.user)
    const label = getWatchedUser(settings, uid)?.nick

    push({
        title: `${label ? `${label} (${name})` : name} updated their profile`,
        body:  `Changed: ${changed.map(f => FIELD_LABELS[f]).join(", ")}`,
        icon:  u?.getAvatarURL(undefined, undefined, false),
        onClick: () => openUserProfile(uid),
    })

    // update cache so next diff is against the latest data
    profileCache[uid] = freshData
}

// polls all watched users' profiles in the background
// runs every POLL_INTERVAL ms - discord doesn't push bio/banner/accent changes
// over websocket so without this you'd never know
const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes

async function pollProfiles() {
    const list = getWatchlist(settings)
    if (list.length === 0) return

    log.info(`polling profiles for ${list.length} watched user(s)`)

    for (const wu of list) {
        try {
            const { body } = await RestAPI.get({
                url: `/users/${wu.id}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            })
            checkProfileChanged(wu.id, camelize(body))
        } catch {
            // user might have blocked requests, skip silently
        }

        // small delay between requests so we don't hammer discord's API
        await new Promise(r => setTimeout(r, 1500))
    }
}

// ---------- plugin ----------

export default definePlugin({
    name: "UserRadar",
    description: "Watch specific users and get notified about their messages, edits, deletes, typing, voice activity, profile changes, and more.",
    authors: [{ id: 641266820187160576, name: "k1ng_op" }],

    settings,

    // custom panel at the top of the settings page
    settingsAboutComponent() {
        return (
            <div>
                <Text variant="heading-sm/semibold" style={{ marginBottom: 8 }}>
                    Watchlist
                </Text>
                <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", marginBottom: 12 }}>
                    Manage the users you're tracking below. You can also right-click any user on Discord → "Watch User" to add them on the fly.
                    Expand individual users in the list to set per-user overrides.
                </Text>
                <button
                    style={{
                        background: "var(--brand-500)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        padding: "8px 14px",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 14,
                        width: "100%",
                    }}
                    onClick={() => openModal(p => (
                        <WatchlistModal modalProps={p} settings={settings} />
                    ))}
                >
                    Open Watchlist Manager
                </button>
            </div>
        )
    },

    flux: {
        // ── new message ──────────────────────────────────────────────────────
        MESSAGE_CREATE(evt: MsgCreateEvent) {
            const { message, guildId, channelId } = evt
            if (!message?.author?.id) return
            if (!featureOn(settings, message.author.id, "msgs", "globalMsgs")) return
            if (settings.store.skipCurrentChannel && getCurrentChannel()?.id === channelId) return

            const u = UserStore.getUser(message.author.id)
            const name = displayName(u ?? message.author)
            const label = getWatchedUser(settings, message.author.id)?.nick

            // type 7 = guild member join message, handle separately
            if (message.type === 7) {
                push({
                    title: `${label ? `${label} (${name})` : name} joined a server`,
                    body: "Click to view",
                    icon: u?.getAvatarURL(undefined, undefined, false),
                    onClick: () => jumpTo(guildId, channelId, message.id),
                })
                return
            }

            push({
                title: `${label ? `${label} (${name})` : name} sent a message`,
                body: msgPreview(message.content, message.attachments?.[0]?.filename),
                icon: u?.getAvatarURL(undefined, undefined, false),
                onClick: () => jumpTo(guildId, channelId, message.id),
            })
        },

        // ── edit ─────────────────────────────────────────────────────────────
        MESSAGE_UPDATE(evt: MsgUpdateEvent) {
            const { message, guildId } = evt
            if (!message?.author?.id) return
            if (!featureOn(settings, message.author.id, "edits", "globalEdits")) return
            if (settings.store.skipCurrentChannel && getCurrentChannel()?.id === message.channel_id) return

            const u = UserStore.getUser(message.author.id)
            const name = displayName(u ?? message.author)
            const label = getWatchedUser(settings, message.author.id)?.nick

            push({
                title: `${label ? `${label} (${name})` : name} edited a message`,
                body: msgPreview(message.content, message.attachments?.[0]?.filename),
                icon: u?.getAvatarURL(undefined, undefined, false),
                onClick: () => jumpTo(guildId, message.channel_id, message.id),
            })
        },

        // ── delete ───────────────────────────────────────────────────────────
        async MESSAGE_DELETE(evt: MsgDeleteEvent) {
            if (!evt?.channelId || !evt?.id) return

            // try to find the deleted message - discord might still have it cached
            // if not, fall back to what the logger plugin saved
            let msg: Message | undefined = MessageStore.getMessage(evt.channelId, evt.id)
            if (!msg) {
                const store = await tryLoadLoggedMsgs()
                msg = store?.[evt.id] as Message | undefined
            }

            if (!msg?.author?.id) return
            if (!featureOn(settings, msg.author.id, "deletes", "globalDeletes")) return
            if (settings.store.skipCurrentChannel && getCurrentChannel()?.id === msg.channel_id) return

            const u = UserStore.getUser(msg.author.id)
            const name = displayName(u ?? msg.author)
            const label = getWatchedUser(settings, msg.author.id)?.nick

            const body = settings.store.showPreview && msg.content
                ? `"${truncate(msg.content, settings.store.previewLen)}"`
                : "Message was deleted"

            push({
                title: `${label ? `${label} (${name})` : name} deleted a message`,
                body,
                icon: u?.getAvatarURL(undefined, undefined, false),
                onClick: () => jumpTo(evt.guildId, msg!.channel_id, msg!.id),
            })
        },

        // ── typing ───────────────────────────────────────────────────────────
        TYPING_START(evt: TypingEvent) {
            if (!evt?.userId || !evt?.channelId) return
            if (!featureOn(settings, evt.userId, "typing", "globalTyping")) return
            if (settings.store.skipCurrentChannel && getCurrentChannel()?.id === evt.channelId) return

            const u = UserStore.getUser(evt.userId)
            if (!u) return

            const name = displayName(u)
            const label = getWatchedUser(settings, evt.userId)?.nick
            const ch = ChannelStore.getChannel(evt.channelId)

            push({
                title: `${label ? `${label} (${name})` : name} is typing…`,
                body: ch?.name ? `In #${ch.name}` : "Click to jump",
                icon: u.getAvatarURL(undefined, undefined, false),
                onClick: () => jumpTo(ch?.guild_id, evt.channelId),
            })
        },

        // ── profile change ───────────────────────────────────────────────────
        // USER_UPDATE fires instantly over websocket when username/avatar/discriminator
        // changes - this is the fast path for those fields
        USER_UPDATE(evt: { user: any }) {
            if (!evt?.user?.id) return
            const uid = evt.user.id
            if (!isWatched(settings, uid)) return
            if (!featureOn(settings, uid, "profile", "globalProfile")) return

            // merge the partial update into whatever we have cached
            // USER_UPDATE doesn't include bio/banner so we can't check those here
            const old = profileCache[uid]
            if (!old) return // no baseline yet, poll will handle first-run

            const fresh = { ...old, user: { ...old.user, ...camelize(evt.user) } }
            checkProfileChanged(uid, fresh as ProfileFetchEvent)
        },

        // USER_PROFILE_FETCH_SUCCESS fires whenever discord fetches a full profile
        // (opening profile popup, viewing someone's profile page, etc.)
        // this catches bio/banner/accent changes opportunistically between polls
        async USER_PROFILE_FETCH_SUCCESS(rawEvt: ProfileFetchEvent) {
            if (!rawEvt?.user?.id) return
            checkProfileChanged(rawEvt.user.id, camelize(rawEvt) as ProfileFetchEvent)
        },

        // ── voice ────────────────────────────────────────────────────────────
        VOICE_STATE_UPDATES(evt: VoiceStateEvent) {
            if (!settings.store.globalVoice) return

            for (const state of evt.voiceStates ?? []) {
                const { userId, channelId, guildId } = state
                if (!featureOn(settings, userId, "voice", "globalVoice")) continue

                const prev  = vcCache[userId] ?? null
                vcCache[userId] = channelId ?? null

                // no actual change
                if (prev === (channelId ?? null)) continue

                const u    = UserStore.getUser(userId)
                const name = displayName(u)
                const label = getWatchedUser(settings, userId)?.nick
                const dname = label ? `${label} (${name})` : name
                const icon  = u?.getAvatarURL(undefined, undefined, false)

                if (!prev && channelId) {
                    // joined voice
                    const ch = ChannelStore.getChannel(channelId)
                    push({
                        title: `${dname} joined voice`,
                        body: ch ? `#${ch.name}` : "Click to view",
                        icon,
                        onClick: () => jumpTo(guildId, channelId),
                    })
                } else if (prev && !channelId) {
                    // left voice
                    push({
                        title: `${dname} left voice`,
                        body: "They disconnected",
                        icon,
                        onClick: () => openUserProfile(userId),
                    })
                } else if (prev && channelId && prev !== channelId) {
                    // moved to a different channel
                    const ch = ChannelStore.getChannel(channelId)
                    push({
                        title: `${dname} moved voice channels`,
                        body: ch ? `Now in #${ch.name}` : "Click to view",
                        icon,
                        onClick: () => jumpTo(guildId, channelId),
                    })
                }
            }
        },

        // ── status ───────────────────────────────────────────────────────────
        PRESENCE_UPDATES(evt: PresenceEvent) {
            if (!settings.store.globalStatus) return

            for (const update of evt.updates ?? []) {
                const { id } = update.user
                if (!featureOn(settings, id, "status", "globalStatus")) continue

                const prev = statusCache[id]
                statusCache[id] = update.status

                if (!prev || prev === update.status) continue

                const u    = UserStore.getUser(id)
                const name = displayName(u)
                const label = getWatchedUser(settings, id)?.nick

                push({
                    title: `${label ? `${label} (${name})` : name} is now ${update.status} ${STATUS_EMOJI[update.status] ?? ""}`,
                    body: `Was: ${prev} ${STATUS_EMOJI[prev] ?? ""}`,
                    icon: u?.getAvatarURL(undefined, undefined, false),
                    onClick: () => openUserProfile(id),
                })
            }
        },
    },

    // ---------- plugin start / stop ----------

    async start() {
        addContextMenuPatch("user-context", userContextPatch)

        // request OS notification permission upfront
        // in electron this is usually already granted, but good to ask explicitly
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
            Notification.requestPermission().then(p => {
                log.info("notification permission:", p)
            })
        }

        // pre-fetch profiles for everyone on the watchlist as the baseline
        // so we don't fire false positives on first run
        for (const wu of getWatchlist(settings)) {
            try {
                const { body } = await RestAPI.get({
                    url: `/users/${wu.id}/profile`,
                    query: { with_mutual_guilds: false, with_mutual_friends_count: false },
                })
                profileCache[wu.id] = camelize(body)
                log.info(`cached baseline for ${wu.id} (${profileCache[wu.id]?.user?.globalName ?? wu.id})`)
            } catch {
                log.warn(`couldn't pre-fetch profile for ${wu.id}`)
            }
        }

        // start the background poll - this is the only reliable way to catch
        // bio / banner / accent color changes since discord never pushes those
        pollTimer = setInterval(pollProfiles, POLL_INTERVAL)
        log.info(`profile poll started, interval: ${POLL_INTERVAL / 1000}s`)

        // try to hook into the logger plugin's message store for delete tracking
        tryLoadLoggedMsgs().then(m => {
            if (m) log.info("hooked into message logger store, delete tracking ready")
            else log.warn("message logger not found - delete tracking will only work if discord has the msg cached")
        })
    },

    stop() {
        removeContextMenuPatch("user-context", userContextPatch)

        if (pollTimer) {
            clearInterval(pollTimer)
            pollTimer = null
        }

        // clear runtime state
        for (const k in profileCache) delete profileCache[k]
        for (const k in vcCache) delete vcCache[k]
        for (const k in statusCache) delete statusCache[k]
        loggedMsgs = null
    },

    // called by context menu
    async watchUser(id: string) {
        const u    = UserStore.getUser(id)
        const name = displayName(u)

        addUser(settings, id)

        Toasts.show({
            type: Toasts.Type.SUCCESS,
            message: `Now watching ${name}`,
            id: Toasts.genId(),
        })

        // cache their profile as baseline right away
        // using checkProfileChanged with an empty cache means it'll store but not fire notif
        try {
            const { body } = await RestAPI.get({
                url: `/users/${id}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            })
            // store directly as baseline, don't diff (no old data to compare against)
            profileCache[id] = camelize(body)
        } catch { /* non-fatal */ }
    },

    unwatchUser(id: string) {
        const u    = UserStore.getUser(id)
        const name = displayName(u)

        removeUser(settings, id)
        delete profileCache[id]
        delete vcCache[id]
        delete statusCache[id]

        Toasts.show({
            type: Toasts.Type.SUCCESS,
            message: `Stopped watching ${name}`,
            id: Toasts.genId(),
        })
    },
})

// ---------- right-click context menu ----------

const userContextPatch: NavContextMenuPatchCallback = (children, props) => {
    // don't add it for ourselves
    if (!props?.user || props.user.id === UserStore.getCurrentUser()?.id) return

    const { id } = props.user
    const watching = isWatched(settings, id)

    // avoid double-patching (can happen if the callback fires twice)
    if (children.some((c: any) => c?.props?.id === "userradar-group")) return

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuGroup id="userradar-group">
            <Menu.MenuItem
                id="userradar-toggle"
                label={watching ? "👁 Stop Watching User" : "👁 Watch User"}
                // using plugin ref from definePlugin's return - access via Vencord
                action={() => {
                    const plugin = Vencord.Plugins.plugins["UserRadar"] as any
                    watching ? plugin.unwatchUser(id) : plugin.watchUser(id)
                }}
            />
            {watching && (
                <Menu.MenuItem
                    id="userradar-manage"
                    label="⚙ Manage Watchlist"
                    action={() => openModal(p => (
                        <WatchlistModal modalProps={p} settings={settings} />
                    ))}
                />
            )}
        </Menu.MenuGroup>
    )
}
