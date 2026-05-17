// index.tsx — UserRadar
// k1ng_op
//
// stalker plugin, basically
// watch specific discord users and get pinged whenever they do anything
// msgs, edits, deletes, typing, profile/pfp changes, voice, status, activity, boosts, joins

import { addContextMenuPatch, NavContextMenuPatchCallback, removeContextMenuPatch } from "@api/ContextMenu"
import { Notifications } from "@api/index"
import { definePluginSettings } from "@api/Settings"
import { getCurrentChannel, openUserProfile } from "@utils/discord"
import { openModal, ModalRoot, ModalHeader, ModalContent, ModalFooter, ModalCloseButton, ModalSize } from "@utils/modal"
import definePlugin, { OptionType } from "@utils/types"
import { findByProps } from "@webpack"
import { Button, ChannelStore, Menu, MessageStore, React, RestAPI, Text, TextInput, Toasts, UserStore } from "@webpack/common"
import { Message } from "discord-types/general"

import {
    addUser, camelize, displayName, featureOn,
    getWatchedUser, getWatchlist, inQuietHours,
    isWatched, log, patchUser, removeUser, STATUS_EMOJI
} from "./store"

import {
    GuildMemberEvent, MsgCreateEvent, MsgDeleteEvent, MsgUpdateEvent,
    PresenceEvent, ProfileFetchEvent,
    TypingEvent, VoiceStateEvent, WatchedUser
} from "./types"

// these all reset when plugin stops, pre-populated in start() to avoid false positives
const profileCache:  Record<string, any>                          = {}
const vcCache:       Record<string, string | null>                = {}  // last known vc per user
const statusCache:   Record<string, string>                       = {}  // last known status
const activityCache: Record<string, string | null | undefined>    = {}  // undefined = never seen
const guildCache:    Record<string, Set<string>>                  = {}  // guilds each user is in

let loggedMsgs: Record<string, Message> | null = null
let pollTimer:  ReturnType<typeof setInterval> | null = null

// grab the logged messages store from message logger enhanced
// dynamic import doesn't work in vencord's plugin system so we check a few places
function tryLoadLoggedMsgs() {
    if (loggedMsgs) return loggedMsgs

    // try the plugin registry first — works regardless of folder name
    try {
        const plugin = (Vencord as any)?.Plugins?.plugins?.["vc-message-logger-enhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["MessageLoggerEnhanced"]
            ?? (Vencord as any)?.Plugins?.plugins?.["messageLoggerEnhanced"]
        if (plugin?.loggedMessages)       { loggedMsgs = plugin.loggedMessages;       return loggedMsgs }
        if (plugin?.store?.loggedMessages) { loggedMsgs = plugin.store.loggedMessages; return loggedMsgs }
    } catch { }

    // fallback: scan webpack chunks
    try {
        const { wreq } = (window as any).webpackChunkdiscord_app?.find?.(
            (x: any) => x?.[1]?.["loggedMessages"]
        )?.[1] ?? {}
        if (wreq?.["loggedMessages"]) { loggedMsgs = wreq["loggedMessages"]; return loggedMsgs }
    } catch { }

    return null
}

// settings

const settings = definePluginSettings({
    watchlist:          { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "watchlist json — managed by the ui, don't touch" },
    globalMsgs:         { type: OptionType.BOOLEAN, default: true,                   description: "messages" },
    globalEdits:        { type: OptionType.BOOLEAN, default: true,                   description: "message edits" },
    globalDeletes:      { type: OptionType.BOOLEAN, default: true,                   description: "message deletes (content needs vc-message-logger-enhanced)" },
    globalTyping:       { type: OptionType.BOOLEAN, default: true,                   description: "typing (works in servers and dms)" },
    globalProfile:      { type: OptionType.BOOLEAN, default: true,                   description: "profile changes (bio, banner, username, colors)" },
    globalAvatar:       { type: OptionType.BOOLEAN, default: true,                   description: "avatar changes" },
    globalVoice:        { type: OptionType.BOOLEAN, default: true,                   description: "voice joins / leaves / moves" },
    globalStatus:       { type: OptionType.BOOLEAN, default: false,                  description: "status changes — spammy, off by default" },
    globalBoosts:       { type: OptionType.BOOLEAN, default: true,                   description: "server boosts" },
    globalActivity:     { type: OptionType.BOOLEAN, default: false,                  description: "activity changes (playing, listening, watching) — very spammy, off by default" },
    globalJoins:        { type: OptionType.BOOLEAN, default: true,                   description: "server joins / leaves (only servers you're in)" },
    showPreview:        { type: OptionType.BOOLEAN, default: true,                   description: "show message content in notifications" },
    previewLen:         { type: OptionType.NUMBER,  default: 120,                    description: "max chars in preview (0 = no limit)" },
    quietHours:         { type: OptionType.BOOLEAN, default: false,                  description: "silence all notifications during certain hours" },
    quietStart:         { type: OptionType.STRING,  default: "23:00",                description: "quiet hours start (24h, e.g. 23:00)" },
    quietEnd:           { type: OptionType.STRING,  default: "07:00",                description: "quiet hours end (24h, e.g. 07:00)" },
    skipCurrentChannel: { type: OptionType.BOOLEAN, default: true,                   description: "skip notification if you're already in that channel" },
    debugLog:           { type: OptionType.BOOLEAN, default: false,                  description: "log all events to console" },
    globalPresetMode:   { type: OptionType.STRING,  default: "custom",               description: "global preset mode — custom, stalker, lite, silent" },
    showToolbarIcon:    { type: OptionType.BOOLEAN, default: true,                   description: "show watchlist icon in toolbar" },
})

// notification helpers

function trunc(s: string, max: number) {
    return max > 0 && s.length > max ? s.slice(0, max) + "…" : s
}

function msgPreview(content: string, filename?: string) {
    if (!settings.store.showPreview) return "click to jump"
    return trunc(content || filename || "click to jump", settings.store.previewLen)
}

function jumpTo(guildId?: string, channelId?: string, msgId?: string) {
    if (guildId)   findByProps("transitionToGuildSync")?.transitionToGuildSync(guildId)
    if (channelId) findByProps("selectChannel")?.selectChannel({ guildId: guildId ?? "@me", channelId, messageId: msgId })
}

// checks if a feature is on for a specific user, respects preset mode and per-user overrides
function isFeatureOn(uid: string, userKey: keyof WatchedUser["overrides"], globalKey: string): boolean {
    if (!isWatched(settings, uid)) return false
    const mode = settings.store.globalPresetMode
    if (mode && mode !== "custom") {
        if (mode === "silent") return false
        if (mode === "stalker") return true
        if (mode === "lite") {
            const liteFeatures = ["msgs", "edits", "deletes", "typing", "avatar", "voice"]
            return liteFeatures.includes(userKey as string)
        }
    }
    return featureOn(settings, uid, userKey, globalKey)
}

function notify(opts: { title: string; body: string; icon?: string; onClick?: () => void }) {
    if (inQuietHours(settings)) return
    if (settings.store.debugLog) log.info(`[notif] ${opts.title} — ${opts.body}`)
    Notifications.showNotification({ title: opts.title, body: opts.body, icon: opts.icon, onClick: opts.onClick })
}

// cdn url helpers
// building these manually bc getAvatarURL() changes signature every few discord updates

function avatarUrl(id: string, hash?: string | null, size = 80): string {
    try {
        if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=${size}`
        let i = 0
        try { i = Number(BigInt(id) % BigInt(6)) } catch { i = parseInt(id.slice(-4), 10) % 6 || 0 }
        return `https://cdn.discordapp.com/embed/avatars/${i}.png`
    } catch { return "https://cdn.discordapp.com/embed/avatars/0.png" }
}

function safeAvatar(id: string, hash?: string | null, size = 80) { return avatarUrl(id, hash, size) }

function bannerUrl(id: string, hash?: string | null): string | null {
    if (!hash) return null
    return `https://cdn.discordapp.com/banners/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=480`
}

function hexColor(n?: number | null): string | null {
    if (n == null) return null
    try { return "#" + n.toString(16).padStart(6, "0") } catch { return null }
}

const FALLBACK_AV = "https://cdn.discordapp.com/embed/avatars/0.png"

// profile change detection
// only track text fields — color fields (accentColor, bannerColor) removed bc they
// cause constant false positives from null/0/undefined endpoint inconsistencies

const PROFILE_TEXT = ["username", "globalName", "bio", "banner"] as const
const FIELD_NAME: Record<string, string> = {
    username: "username", globalName: "display name",
    bio: "bio", banner: "banner",
}

// diff a fresh profile against what we have cached and notify on any real changes
function checkProfileChanged(uid: string, fresh: any) {
    if (!isWatched(settings, uid)) return
    const old = profileCache[uid]
    if (!old) {
        profileCache[uid] = fresh
        return
    }
    if (fresh.user?.avatar !== old.user?.avatar) {
        if (isFeatureOn( uid, "avatar", "globalAvatar")) {
            const name  = displayName(fresh.user)
            const label = getWatchedUser(settings, uid)?.nick
            const dn    = label ? `${label} (${name})` : name
            notify({
                title: `${dn} changed their avatar`,
                body: "click to see new pfp",
                icon: fresh.user?.avatar
                    ? `https://cdn.discordapp.com/avatars/${uid}/${fresh.user.avatar}.webp?size=128`
                    : undefined,
                onClick: () => openUserProfile(uid),
            })
        }
        profileCache[uid] = { ...profileCache[uid], user: { ...profileCache[uid].user, avatar: fresh.user?.avatar } }
    }
    const changed: string[] = []
    for (const f of PROFILE_TEXT) {
        if ((fresh.user?.[f] ?? null) !== (old.user?.[f] ?? null)) changed.push(f)
    }
    if (changed.length > 0 && isFeatureOn( uid, "profile", "globalProfile")) {
        const u     = UserStore.getUser(uid)
        const name  = displayName(fresh.user)
        const label = getWatchedUser(settings, uid)?.nick
        const dn    = label ? `${label} (${name})` : name
        notify({
            title: `${dn} updated their profile`,
            body: changed.map(f => FIELD_NAME[f] ?? f).join(", "),
            icon: u ? safeAvatar(u.id, (u as any).avatar) : undefined,
            onClick: () => openUserProfile(uid),
        })
    }
    profileCache[uid] = fresh
}

// poll profiles every 5 mins — discord doesn't push bio/banner changes over websocket
async function pollProfiles() {
    const list = getWatchlist(settings)
    if (!list.length) return
    for (const wu of list) {
        try {
            const { body } = await RestAPI.get({
                url: `/users/${wu.id}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            })
            checkProfileChanged(wu.id, camelize(body))
        } catch { }
        await new Promise(r => setTimeout(r, 1500))
    }
}

// modal ui

const STYLE_ID = "ur-s9"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = `
        @keyframes ur-spin { to { transform:rotate(360deg) } }
        .ur-spin { display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2.5px solid #3f4147;border-top-color:#dbdee1;
            animation:ur-spin .55s linear infinite;vertical-align:middle; }
        @keyframes ur-fade-in { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
        .ur-fade-in { animation:ur-fade-in .2s cubic-bezier(.4,0,.2,1) forwards; }
        .ur-expand { display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s cubic-bezier(.4,0,.2,1); }
        .ur-expand.open { grid-template-rows:1fr; }
        .ur-expand > div { overflow:hidden; }
        .ur-row-hover:hover { background:rgba(255,255,255,0.06); }
        .ur-scrollbar::-webkit-scrollbar { width:6px; }
        .ur-scrollbar::-webkit-scrollbar-track { background:#232428;border-radius:3px; }
        .ur-scrollbar::-webkit-scrollbar-thumb { background:#3f4147;border-radius:3px; }
        .ur-scrollbar::-webkit-scrollbar-thumb:hover { background:#4a4a6e; }
        .ur-typing-dot { animation: ur-typing 1.4s infinite ease-in-out both; }
        .ur-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ur-typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes ur-typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        @keyframes ur-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); } 20%, 40%, 60%, 80% { transform: translateX(4px); } }
        .ur-shake { animation: ur-shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes ur-pulse { 0% { box-shadow: 0 0 0 0 #5865f2; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        .ur-pulse { animation: ur-pulse 2s infinite; }
        @keyframes ur-flash-green { 0% { background: #248046; } 100% { background: #5865f2; } }
        .ur-flash-green { animation: ur-flash-green 0.5s ease; }
    `
    document.head.appendChild(s)
}

const C = {
    bg1:         "#1e1f22",
    bg2:         "#2b2d31",
    bg3:         "#313338",
    bgEl:        "#3f4147",
    border:      "#3f4147",
    hov:         "rgba(255,255,255,0.06)",
    header:      "#f2f3f5",
    subheader:   "#b5bac1",
    text:        "#dbdee1",
    muted:       "#949ba4",
    danger:      "#fa777c",
    brand:       "#5865f2",
    brandLight:  "#949cf4",
    brandGrad:   "linear-gradient(135deg, #5865f2 0%, #949cf4 100%)",
    green:       "#248046",
    red:         "#da373c",
    white:       "#ffffff",
    expanded:    "#232428",
} as const

const ico = {
    search:   () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
    check:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    x:        () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    chevron:  () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>,
    trash:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    copy:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2"/></svg>,
    external: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    sortAz:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h12M3 12h8M3 18h4M16 8l4-4 4 4M20 4v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    sortDate: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    eye:      () => <svg width="20" height="20" viewBox="0 0 24 24" fill={C.white}><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>,
    ghost:    () => <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity=".25"><path d="M12 2a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-4h6v4h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9zm-3 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>,
    msg:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    edit:     () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    del:      () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 3v-1a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v1H3v2h2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5h2V3h-6zm-4-1h2v1h-2V2zm-2 5h2v9h-2V7zm4 0h2v9h-2V7z"/></svg>,
    typing:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="20" cy="12" r="2"/></svg>,
    profile:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2"/></svg>,
    avatar:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="2"/><path d="M7 21c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="2"/></svg>,
    voice:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>,
    status:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".3"/><circle cx="12" cy="12" r="5"/></svg>,
    boosts:   () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6-4.8-6 4.8 2.4-7.2-6-4.8h7.6z"/></svg>,
    activity: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>,
    joins:    () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2"/><circle cx="8.5" cy="7" r="4" stroke="currentColor" strokeWidth="2"/><path d="M20 8v6M23 11h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>,
    history:  () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    monitor:  () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
    preview:  () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
}

const CtxEyeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
)
const CtxEyeOffIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
)
const CtxGearIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
)

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            role="switch" aria-checked={on}
            onClick={() => onChange(!on)}
            style={{
                width: 36, height: 22, borderRadius: 11, flexShrink: 0,
                background: on ? "#5865f2" : "#3f4147",
                cursor: "pointer", position: "relative",
                transition: "background 150ms ease",
            }}
        >
            <div style={{
                position: "absolute", top: 2, left: on ? 16 : 2,
                width: 18, height: 18, borderRadius: "50%",
                background: C.white, boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                transition: "left 150ms cubic-bezier(0.4,0,0.2,1)",
            }} />
        </div>
    )
}

type LookupStage =
    | { s: "idle" }
    | { s: "loading" }
    | { s: "done"; user: any; av: string }
    | { s: "err"; msg: string }

function timeAgo(ts: number): string {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return "Just now"
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(ts).toLocaleDateString()
}

function exactTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

const activityLog: Record<string, { ts: number; type: string; icon: string; body: string; guildId?: string; channelId?: string; msgId?: string }[]> = {}

function logActivity(uid: string, type: string, icon: string, body: string, guildId?: string, channelId?: string, msgId?: string) {
    if (!activityLog[uid]) activityLog[uid] = []
    activityLog[uid].unshift({ ts: Date.now(), type, icon, body, guildId, channelId, msgId })
    if (activityLog[uid].length > 50) activityLog[uid].pop()
}

function AddUserInput({ rawId, setRawId, hasErr, lk, setLk, doLookup }: {
    rawId: string
    setRawId: (v: string) => void
    hasErr: boolean
    lk: LookupStage
    setLk: (v: LookupStage) => void
    doLookup: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    const [btnState, setBtnState] = React.useState<"idle" | "valid" | "searching" | "found" | "notfound">("idle")
    const btnRef = React.useRef<HTMLButtonElement>(null)
    const borderColor = hasErr ? C.red : focused ? C.brand : C.border

    React.useEffect(() => {
        const clean = rawId.trim().replace(/\D/g, "")
        if (lk.s === "loading") setBtnState("searching")
        else if (lk.s === "done") {
            setBtnState("found")
            const t = setTimeout(() => setBtnState("idle"), 2000)
            return () => clearTimeout(t)
        }
        else if (lk.s === "err") {
            setBtnState("notfound")
            const t = setTimeout(() => setBtnState("idle"), 3000)
            return () => clearTimeout(t)
        }
        else if (clean.length >= 17 && clean.length <= 20) setBtnState("valid")
        else setBtnState("idle")
    }, [rawId, lk.s])

    const btnStyle: React.CSSProperties = {
        borderRadius: 20,
        height: 40,
        boxSizing: "border-box",
        padding: "0 20px",
        color: "#ffffff",
        border: "none",
        fontSize: 14,
        fontWeight: 600,
        cursor: btnState === "idle" ? "not-allowed" : "pointer",
        flexShrink: 0,
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 200ms ease, opacity 200ms ease",
    }

    const getBtnBg = () => {
        if (btnState === "found") return "#248046"
        if (btnState === "notfound") return "#da373c"
        if (btnState === "searching") return "#4752c4"
        if (btnState === "valid") return "#5865f2"
        return "rgba(255,255,255,0.06)"
    }

    const getBtnText = () => {
        if (btnState === "found") return "Added ✓"
        if (btnState === "notfound") return "Not found"
        if (btnState === "searching") return <><span className="ur-spin" style={{ marginRight: 6 }} />Searching...</>
        return "look up"
    }

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <input
                    placeholder="paste a discord user id"
                    value={rawId}
                    onChange={(e) => { setRawId(e.target.value); if (hasErr) setLk({ s: "idle" }) }}
                    onKeyDown={(e) => { if (e.key === "Enter" && btnState !== "idle") doLookup() }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoFocus
                    style={{
                        background: "#1e1f22",
                        borderRadius: 20,
                        border: `1px solid ${borderColor}`,
                        height: 40,
                        boxSizing: "border-box",
                        padding: "0 14px",
                        transition: "border-color 150ms ease, box-shadow 150ms ease",
                        width: "100%",
                        fontSize: 14,
                        color: "#dbdee1",
                        outline: "none",
                        fontFamily: "inherit",
                        boxShadow: focused ? "inset 0 0 0 1px #5865f2" : "none",
                    }}
                />
                <div style={{ fontSize: 11, color: hasErr ? C.danger : C.muted, marginTop: 5, display: "flex", alignItems: "center", gap: 4 }}>
                    {hasErr ? <ico.x /> : null}
                    {hasErr ? (lk as any).msg : "developer mode → right-click user → copy user id"}
                </div>
            </div>
            <button
                ref={btnRef}
                onClick={() => { if (btnState !== "idle") doLookup() }}
                className={btnState === "notfound" ? "ur-shake" : btnState === "valid" ? "ur-pulse" : ""}
                style={{ ...btnStyle, background: getBtnBg(), opacity: btnState === "idle" ? 0.5 : 1 }}
            >
                {getBtnText()}
            </button>
        </div>
    )
}

function AddLabelInput({ label, setLabel, doAdd }: {
    label: string
    setLabel: (v: string) => void
    doAdd: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder='e.g. "bestie", "the rat", "ex"'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doAdd() }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            style={{
                background: "#1e1f22",
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                height: 40,
                boxSizing: "border-box",
                padding: "0 14px",
                transition: "border-color 150ms ease",
                width: "100%",
                fontSize: 14,
                color: "#dbdee1",
                outline: "none",
                fontFamily: "inherit",
                marginBottom: 14,
            }}
        />
    )
}

function AddUserSection({ onAdded }: { onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupStage>({ s: "idle" })

    const cleanId = rawId.trim().replace(/\D/g, "")
    const hasErr  = lk.s === "err"

    const doLookup = () => {
        if (!cleanId)                                    return setLk({ s: "err", msg: "enter a user id first" })
        if (cleanId.length < 17 || cleanId.length > 20) return setLk({ s: "err", msg: "discord ids are 17-20 digits" })
        if (isWatched(settings, cleanId))                return setLk({ s: "err", msg: "already on your watchlist" })

        setLk({ s: "loading" })
        RestAPI.get({
            url: `/users/${cleanId}/profile`,
            query: { with_mutual_guilds: false, with_mutual_friends_count: false },
        }).then((res: any) => {
            const d = camelize(res.body)
            setLk({ s: "done", user: d.user, av: avatarUrl(d.user.id, d.user.avatar, 64) })
        }).catch((e: any) => {
            const code = e?.status ?? e?.response?.status
            setLk({
                s: "err",
                msg: code === 404 ? "user not found"
                   : code === 403 ? "profile is private (no shared server) — you can still add by id"
                   : `request failed${code ? ` (${code})` : ""}`,
            })
        })
    }

    const doAdd = () => {
        if (lk.s !== "done") return
        addUser(settings, cleanId, label.trim())
        setRawId(""); setLabel(""); setLk({ s: "idle" })
        onAdded()
    }

    return (
        <div className="ur-fade-in">
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 12 }}>
                add user
            </div>

            {lk.s !== "done" && (
                <AddUserInput
                    rawId={rawId}
                    setRawId={setRawId}
                    hasErr={hasErr}
                    lk={lk}
                    setLk={setLk}
                    doLookup={doLookup}
                />
            )}

            {lk.s === "done" && (
                <div className="ur-fade-in">
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "12px 16px",
                        background: C.bg1,
                        borderRadius: 20,
                        border: `1px solid ${C.border}`,
                        marginBottom: 14,
                    }}>
                        <img
                            src={lk.av}
                            style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0 }}
                            onError={(e: any) => { e.target.src = FALLBACK_AV }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: C.header }}>
                                {lk.user.globalName || lk.user.username}
                            </div>
                            {lk.user.globalName && (
                                <div style={{ fontSize: 13, color: C.muted, marginTop: 1 }}>
                                    @{lk.user.username}
                                </div>
                            )}
                            <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontFamily: "monospace", opacity: .6 }}>
                                {lk.user.id}
                            </div>
                        </div>
                        <div style={{
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            background: "rgba(36,128,70,0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                        }}>
                            <div style={{ color: C.green }}><ico.check /></div>
                        </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 6 }}>
                        label <span style={{ fontWeight: 500, color: C.muted, textTransform: "none" }}>(optional, only you see this)</span>
                    </div>
                    <AddLabelInput label={label} setLabel={setLabel} doAdd={doAdd} />

                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={doAdd}
                            style={{
                                flex: 1,
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 20px",
                                background: C.green,
                                color: "#ffffff",
                                border: "none",
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = "#2d9c5a" }}
                            onMouseLeave={e => { e.currentTarget.style.background = C.green }}
                        >
                            add to watchlist
                        </button>
                        <button
                            onClick={() => { setLk({ s: "idle" }); setLabel("") }}
                            style={{
                                borderRadius: 20,
                                height: 40,
                                boxSizing: "border-box",
                                padding: "0 18px",
                                background: "transparent",
                                color: C.text,
                                border: `1px solid ${C.border}`,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                transition: "background 150ms ease, border-color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = "rgba(255,255,255,0.05)"
                                e.currentTarget.style.borderColor = C.bgEl
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.borderColor = C.border
                            }}
                        >
                            cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

const OV_GROUPS = {
    messages: [
        { label: "messages",  key: "msgs",     gk: "globalMsgs",     Icon: ico.msg,      desc: "Notify on new messages" },
        { label: "edits",     key: "edits",    gk: "globalEdits",    Icon: ico.edit,     desc: "Notify on message edits" },
        { label: "deletes",   key: "deletes",  gk: "globalDeletes",  Icon: ico.del,      desc: "Notify on deleted messages" },
        { label: "typing",    key: "typing",   gk: "globalTyping",   Icon: ico.typing,   desc: "Notify when typing starts" },
    ],
    presence: [
        { label: "status",    key: "status",   gk: "globalStatus",   Icon: ico.status,   desc: "Notify on status changes" },
        { label: "activity",  key: "activity", gk: "globalActivity", Icon: ico.activity, desc: "Notify on activity changes" },
        { label: "voice",     key: "voice",    gk: "globalVoice",    Icon: ico.voice,    desc: "Notify on voice channel activity" },
        { label: "joins",     key: "joins",    gk: "globalJoins",    Icon: ico.joins,    desc: "Notify on server joins / leaves" },
    ],
    profile: [
        { label: "profile",   key: "profile",  gk: "globalProfile",  Icon: ico.profile,  desc: "Notify on profile changes" },
        { label: "avatar",    key: "avatar",   gk: "globalAvatar",   Icon: ico.avatar,   desc: "Notify on avatar updates" },
        { label: "boosts",    key: "boosts",   gk: "globalBoosts",   Icon: ico.boosts,   desc: "Notify on server boosts" },
    ],
} as const

type OvTab = "messages" | "presence" | "profile"
const OV_TAB_LABELS: Record<OvTab, string> = { messages: "Messages", presence: "Presence", profile: "Profile" }

function LabelInput({ nick, setNick, saveNick }: { nick: string; setNick: (v: string) => void; saveNick: () => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder="label"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() => { setFocused(false); saveNick() }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { setFocused(false); saveNick() } }}
            style={{
                background: C.bg1,
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : C.border}`,
                height: 26,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                fontSize: 12,
                width: "100%",
                margin: 0,
                color: C.text,
                outline: "none",
                transition: "border-color 150ms ease",
                fontFamily: "inherit",
            }}
        />
    )
}

function SearchInput({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <div style={{ position: "relative", width: 160, flexShrink: 0 }}>
            <input
                placeholder="search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => setFocused(false)}
                onFocus={() => setFocused(true)}
                style={{
                    background: "#1e1f22",
                    borderRadius: 20,
                    border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                    height: 28,
                    boxSizing: "border-box",
                    padding: "0 28px 0 12px",
                    width: "100%",
                    fontSize: 13,
                    color: "#dbdee1",
                    outline: "none",
                    fontFamily: "inherit",
                    transition: "border-color 150ms ease",
                }}
            />
            <div style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#949ba4",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
            }}>
                <ico.search />
            </div>
            {query && (
                <div
                    role="button"
                    onClick={() => setQuery("")}
                    style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#949ba4",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        lineHeight: 1,
                    }}
                >
                    <ico.x />
                </div>
            )}
        </div>
    )
}

function previewNotification(uid: string, type: string) {
    const u = UserStore.getUser(uid)
    const label = getWatchedUser(settings, uid)?.nick
    const name = displayName(u) || uid
    const dn = label ? `${label} (${name})` : name
    const icon = u ? safeAvatar(u.id, (u as any).avatar) : undefined

    const previews: Record<string, { title: string; body: string }> = {
        msgs:     { title: `${dn} sent a message`, body: "This is a preview of how message notifications will appear." },
        edits:    { title: `${dn} edited a message`, body: `"before" → "after preview text"` },
        deletes:  { title: `${dn} deleted a message`, body: `"this is a preview of deleted message content"` },
        typing:   { title: `${dn} is typing…`, body: "in #general" },
        status:   { title: `${dn} is now online`, body: "was: offline" },
        activity: { title: `${dn} is playing Game Name`, body: "doing something — details here" },
        voice:    { title: `${dn} joined voice`, body: "#General Voice" },
        joins:    { title: `${dn} joined a server`, body: "Server Name" },
        profile:  { title: `${dn} updated their profile`, body: "bio, display name" },
        avatar:   { title: `${dn} changed their avatar`, body: "click to see new pfp" },
        boosts:   { title: `${dn} boosted a server`, body: "click to view" },
    }

    const p = previews[type] || { title: `${dn}: ${type}`, body: "preview notification" }
    Notifications.showNotification({ title: "[Preview] " + p.title, body: p.body, icon })
}

function WatchedRow({ user, refresh, expandedId, setExpandedId, onRemove }: {
    user: WatchedUser
    refresh: () => void
    expandedId: string | null
    setExpandedId: (id: string | null) => void
    onRemove: () => void
}) {
    const [nick,     setNick] = React.useState(user.nick || "")
    const expanded = expandedId === user.id
    const setExp = (v: boolean) => setExpandedId(v ? user.id : null)
    const [copied,   setCopy] = React.useState(false)
    const [ovTab,    setOvTab] = React.useState<OvTab>("messages")
    const [showLog,  setShowLog] = React.useState(false)

    const du   = UserStore.getUser(user.id)
    const name = displayName(du) || user.id
    const av   = du ? avatarUrl(du.id, (du as any).avatar, 64) : avatarUrl(user.id, null, 64)

    const saveNick = () => { patchUser(settings, user.id, { nick: nick || "" }); refresh() }
    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        const dn = label ? `${label} (${name})` : name
        const featLabel = OV_GROUPS.messages.find(r => r.key === key)?.label
            || OV_GROUPS.presence.find(r => r.key === key)?.label
            || OV_GROUPS.profile.find(r => r.key === key)?.label
            || key
        if (val === true) {
            Toasts.show({ type: Toasts.Type.SUCCESS, message: `${dn}: ${featLabel} enabled`, id: Toasts.genId() })
        } else if (val === false) {
            Toasts.show({ type: Toasts.Type.DEFAULT, message: `${dn}: ${featLabel} disabled`, id: Toasts.genId() })
        } else if (val === null) {
            Toasts.show({ type: Toasts.Type.SUCCESS, message: `${dn}: ${featLabel} reset to global`, id: Toasts.genId() })
        }
    }

    const copyId = () => {
        navigator.clipboard.writeText(user.id)
        setCopy(true)
        setTimeout(() => setCopy(false), 1200)
    }

    const resetAll = () => {
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = {}
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => {
                newOverrides[r.key] = null
            })
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        Toasts.show({ type: Toasts.Type.SUCCESS, message: `${label ? `${label} (${name})` : name}: all overrides reset`, id: Toasts.genId() })
    }

    const enableAll = () => {
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = { ...list[idx].overrides }
        OV_GROUPS[ovTab].forEach(r => {
            newOverrides[r.key] = true
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        Toasts.show({ type: Toasts.Type.SUCCESS, message: `${label ? `${label} (${name})` : name}: all ${OV_TAB_LABELS[ovTab]} enabled`, id: Toasts.genId() })
    }

    const disableAll = () => {
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = { ...list[idx].overrides }
        OV_GROUPS[ovTab].forEach(r => {
            newOverrides[r.key] = false
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        Toasts.show({ type: Toasts.Type.DEFAULT, message: `${label ? `${label} (${name})` : name}: all ${OV_TAB_LABELS[ovTab]} disabled`, id: Toasts.genId() })
    }

    const applyPreset = (preset: "stalker" | "lite" | "silent") => {
        const label = getWatchedUser(settings, user.id)?.nick
        const u = UserStore.getUser(user.id)
        const name = displayName(u) || user.id
        const dn = label ? `${label} (${name})` : name
        Toasts.show({ type: Toasts.Type.SUCCESS, message: `${dn}: ${preset} preset applied`, id: Toasts.genId() })
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const newOverrides: any = {}
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => {
                newOverrides[r.key] = null
            })
        })
        if (preset === "silent") {
            Object.keys(OV_GROUPS).forEach(g => {
                OV_GROUPS[g as OvTab].forEach(r => {
                    newOverrides[r.key] = false
                })
            })
            list[idx] = { ...list[idx], overrides: newOverrides }
            settings.store.watchlist = JSON.stringify(list)
            refresh()
            return
        }
        if (preset === "lite") {
            newOverrides["msgs"] = true
            newOverrides["edits"] = true
            newOverrides["deletes"] = true
            newOverrides["typing"] = true
            newOverrides["avatar"] = true
            newOverrides["voice"] = true
            Object.keys(OV_GROUPS).forEach(g => {
                OV_GROUPS[g as OvTab].forEach(r => {
                    if (!["msgs","edits","deletes","typing","avatar","voice"].includes(r.key)) {
                        newOverrides[r.key] = false
                    }
                })
            })
            list[idx] = { ...list[idx], overrides: newOverrides }
            settings.store.watchlist = JSON.stringify(list)
            refresh()
            return
        }
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => {
                newOverrides[r.key] = true
            })
        })
        list[idx] = { ...list[idx], overrides: newOverrides }
        settings.store.watchlist = JSON.stringify(list)
        refresh()
    }

    const detectPreset = (): "stalker" | "lite" | "silent" | "custom" => {
        const allKeys: string[] = []
        Object.keys(OV_GROUPS).forEach(g => {
            OV_GROUPS[g as OvTab].forEach(r => allKeys.push(r.key))
        })
        const ov = user.overrides as any
        const allFalse = allKeys.every(k => ov[k] === false)
        if (allFalse) return "silent"
        const allTrue = allKeys.every(k => ov[k] === true)
        if (allTrue) return "stalker"
        const liteKeys = ["msgs","edits","deletes","typing","avatar","voice"]
        const isLite = liteKeys.every(k => ov[k] === true) &&
            allKeys.filter(k => !liteKeys.includes(k)).every(k => ov[k] === false)
        if (isLite) return "lite"
        return "custom"
    }

    const activePreset = detectPreset()
    const logs = activityLog[user.id] || []

    return (
        <div style={{ background: C.bg2, borderRadius: 20, marginBottom: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div className="ur-row-hover" onClick={() => setExp(!expanded)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer",
                borderRadius: expanded ? "20px 20px 0 0" : 20, transition: "background 100ms",
            }}>
                <img src={av} style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }}
                    onError={(e: any) => { e.target.src = FALLBACK_AV }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: C.header }}>{name}</span>
                        {user.nick && (
                            <span style={{ background: C.brandGrad, color: C.white, fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                                {user.nick}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontFamily: "monospace", opacity: .7 }}>{user.id}</span>
                        <span>·</span>
                        <span title={exactTime(user.addedAt)}>{timeAgo(user.addedAt)}</span>
                    </div>
                </div>

                <div onClick={(e: any) => e.stopPropagation()} style={{ width: 80, flexShrink: 0 }}>
                    <LabelInput nick={nick} setNick={setNick} saveNick={saveNick} />
                </div>

                <div
                    onClick={(e: any) => { e.stopPropagation(); setShowLog(v => !v); if (!expanded) setExp(true) }}
                    title="Recent user Activity"
                    style={{
                        padding: "5px 12px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        background: showLog ? C.brand : C.bg1,
                        color: showLog ? C.white : (logs.length > 0 ? C.text : C.muted),
                        border: `1px solid ${showLog ? C.brand : C.border}`,
                        transition: "all 150ms cubic-bezier(0.4,0,0.2,1)",
                        userSelect: "none",
                        letterSpacing: 0.3,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        height: 28,
                        boxSizing: "border-box",
                    }}
                >
                    <span style={{ display: "flex", alignItems: "center", opacity: 0.9 }}>
                        <ico.history />
                    </span>
                    <span>Recent</span>
                    <span style={{
                        fontSize: 10,
                        fontWeight: 800,
                        background: showLog ? "rgba(255,255,255,0.2)" : (logs.length > 0 ? C.green : C.bg3),
                        padding: "2px 6px",
                        borderRadius: 6,
                        color: showLog ? C.white : (logs.length > 0 ? C.white : C.muted),
                        minWidth: 18,
                        textAlign: "center",
                        lineHeight: 1,
                    }}>
                        {logs.length}
                    </span>
                </div>

                <div style={{ color: C.muted, display: "flex", alignItems: "center", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 200ms cubic-bezier(.4,0,.2,1)" }}>
                    <ico.chevron />
                </div>

                <div onClick={(e: any) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    {[
                        { title: "copy id",       icon: copied ? <ico.check /> : <ico.copy />, color: copied ? C.green : C.muted, action: copyId },
                        { title: "open profile",  icon: <ico.external />,                       color: C.muted,                   action: () => openUserProfile(user.id) },
                        { title: "remove",        icon: <ico.trash />,                          color: C.red,                     action: onRemove },
                    ].map(btn => (
                        <div key={btn.title} role="button" tabIndex={0} title={btn.title}
                            onClick={btn.action}
                            onKeyDown={(e: any) => { if (e.key === "Enter") btn.action() }}
                            style={{ color: btn.color, cursor: "pointer", padding: 6, borderRadius: 6, display: "flex", alignItems: "center", transition: "background 100ms" }}
                            onMouseEnter={e => (e.currentTarget.style.background = btn.title === "remove" ? "rgba(218,55,60,0.12)" : C.hov)}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                            {btn.icon}
                        </div>
                    ))}
                </div>
            </div>

            <div className={`ur-expand${expanded ? " open" : ""}`}>
                <div>
                    <div style={{ padding: "12px 16px 14px", borderTop: `1px solid ${C.border}`, background: C.bg2 }}>

                        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
                            <div style={{ display: "flex", gap: 4, background: C.bg3, padding: 3, borderRadius: 20, border: `1px solid ${C.border}`, position: "relative" }}>
                                {(["messages", "presence", "profile"] as OvTab[]).map(tab => (
                                    <div
                                        key={tab}
                                        onClick={() => { setOvTab(tab); setShowLog(false) }}
                                        style={{
                                            padding: "5px 14px",
                                            borderRadius: 16,
                                            fontSize: 12,
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            background: ovTab === tab && !showLog ? C.brand : "transparent",
                                            color: ovTab === tab && !showLog ? C.white : C.muted,
                                            transition: "all 200ms cubic-bezier(0.4,0,0.2,1)",
                                            userSelect: "none",
                                            letterSpacing: 0.3,
                                            position: "relative",
                                            zIndex: 2,
                                            transform: ovTab === tab && !showLog ? "scale(1.02)" : "scale(1)",
                                        }}
                                        onMouseEnter={e => {
                                            if (ovTab !== tab) {
                                                e.currentTarget.style.background = C.hov
                                                e.currentTarget.style.color = C.text
                                                e.currentTarget.style.transform = "scale(1.02)"
                                            }
                                        }}
                                        onMouseLeave={e => {
                                            if (ovTab !== tab) {
                                                e.currentTarget.style.background = "transparent"
                                                e.currentTarget.style.color = C.muted
                                                e.currentTarget.style.transform = "scale(1)"
                                            }
                                        }}
                                    >
                                        {OV_TAB_LABELS[tab]}
                                    </div>
                                ))}
                            </div>
                            <div style={{ flex: 1 }} />
                        </div>

                        {showLog ? (
                            <div style={{ background: C.bg1, borderRadius: 16, border: `1px solid ${C.border}`, padding: "14px 16px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, boxShadow: `0 0 6px ${C.green}` }} />
                                    <div style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8, color: C.header }}>
                                        Recent user Activity
                                    </div>
                                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                                        {logs.length > 0 && (
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => { delete activityLog[user.id]; setShowLog(false); setTimeout(() => setShowLog(true), 10) }}
                                                onKeyDown={(e: any) => { if (e.key === "Enter") { delete activityLog[user.id]; setShowLog(false); setTimeout(() => setShowLog(true), 10) } }}
                                                style={{
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    color: C.danger,
                                                    cursor: "pointer",
                                                    padding: "4px 12px",
                                                    borderRadius: 20,
                                                    border: `1px solid ${C.danger}30`,
                                                    background: `${C.danger}10`,
                                                    transition: "all 150ms ease",
                                                    userSelect: "none",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 4,
                                                    height: 24,
                                                    boxSizing: "border-box",
                                                }}
                                                onMouseEnter={e => {
                                                    e.currentTarget.style.background = `${C.danger}20`
                                                    e.currentTarget.style.borderColor = `${C.danger}50`
                                                }}
                                                onMouseLeave={e => {
                                                    e.currentTarget.style.background = `${C.danger}10`
                                                    e.currentTarget.style.borderColor = `${C.danger}30`
                                                }}
                                            >
                                                <ico.x />
                                                Clear logs
                                            </div>
                                        )}
                                        <div style={{ fontSize: 11, color: C.muted }}>
                                            {logs.length} event{logs.length !== 1 ? "s" : ""}
                                        </div>
                                    </div>
                                </div>

                                {logs.length === 0 ? (
                                    <div style={{ fontSize: 14, color: C.muted, padding: "20px 0", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                                        <div style={{ opacity: 0.4 }}><ico.ghost /></div>
                                        <span>no recent activity tracked</span>
                                    </div>
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }} className="ur-scrollbar">
                                        {logs.slice(0, 20).map((log, i) => (
                                            <div
                                                key={i}
                                                onClick={() => jumpTo(log.guildId, log.channelId, log.msgId)}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 12,
                                                    padding: "8px 12px",
                                                    borderRadius: 12,
                                                    cursor: log.channelId ? "pointer" : "default",
                                                    transition: "background 150ms ease",
                                                    background: "transparent",
                                                }}
                                                onMouseEnter={e => { if (log.channelId) e.currentTarget.style.background = C.hov }}
                                                onMouseLeave={e => { e.currentTarget.style.background = "transparent" }}
                                            >
                                                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{log.icon}</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, color: C.text, fontWeight: 500, lineHeight: 1.4 }}>
                                                        {log.body}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                                                        {log.channelId ? `#${ChannelStore.getChannel(log.channelId)?.name || "unknown"} · ` : ""}
                                                        <span title={exactTime(log.ts)}>{timeAgo(log.ts)}</span>
                                                    </div>
                                                </div>
                                                {log.channelId && (
                                                    <div style={{ color: C.muted, flexShrink: 0, opacity: 0.5 }}>
                                                        <ico.external />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div style={{ background: "#313338", borderRadius: 12, border: `1px solid #3f4147`, padding: "16px", marginBottom: 12 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                                        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.8, color: "#b5bac1" }}>
                                            Quick Presets
                                        </div>
                                        <div style={{ fontSize: 11, color: "#949ba4" }}>
                                            one-click tracking profiles
                                        </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        {([
                                            { key: "stalker" as const, label: "Stalker", desc: "Maximum tracking — every event", color: C.danger },
                                            { key: "lite" as const, label: "Lite", desc: "Messages, edits, deletes, typing, avatar, voice", color: C.brandLight },
                                            { key: "silent" as const, label: "Silent", desc: "No notifications at all", color: C.muted },
                                        ]).map(preset => {
                                            const isActive = activePreset === preset.key
                                            return (
                                                <div
                                                    key={preset.key}
                                                    onClick={() => applyPreset(preset.key)}
                                                    style={{
                                                        cursor: "pointer",
                                                        padding: "10px 14px",
                                                        borderRadius: 14,
                                                        transition: "all 150ms ease",
                                                        border: `1px solid ${isActive ? preset.color : `${preset.color}40`}`,
                                                        background: isActive ? `${preset.color}25` : `${preset.color}10`,
                                                        flex: 1,
                                                        minWidth: 120,
                                                    }}
                                                    onMouseEnter={e => {
                                                        if (!isActive) {
                                                            e.currentTarget.style.background = `${preset.color}20`
                                                            e.currentTarget.style.borderColor = `${preset.color}60`
                                                        }
                                                    }}
                                                    onMouseLeave={e => {
                                                        if (!isActive) {
                                                            e.currentTarget.style.background = `${preset.color}10`
                                                            e.currentTarget.style.borderColor = `${preset.color}40`
                                                        }
                                                    }}
                                                >
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                                        {isActive && (
                                                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: preset.color, boxShadow: `0 0 6px ${preset.color}`, display: "inline-block", flexShrink: 0 }} />
                                                        )}
                                                        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: isActive ? preset.color : C.text }}>
                                                            {preset.label}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.4 }}>
                                                        {preset.desc}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
                                    <div
                                        onClick={enableAll}
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: C.brandLight,
                                            cursor: "pointer",
                                            padding: "5px 12px",
                                            borderRadius: 20,
                                            border: `1px solid rgba(148,156,244,0.3)`,
                                            background: "rgba(148,156,244,0.08)",
                                            transition: "all 150ms ease",
                                            height: 26,
                                            boxSizing: "border-box",
                                            display: "flex",
                                            alignItems: "center",
                                            userSelect: "none",
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.background = "rgba(148,156,244,0.15)"
                                            e.currentTarget.style.borderColor = "rgba(148,156,244,0.5)"
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.background = "rgba(148,156,244,0.08)"
                                            e.currentTarget.style.borderColor = "rgba(148,156,244,0.3)"
                                        }}
                                    >Enable All</div>
                                    <div
                                        onClick={disableAll}
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: C.muted,
                                            cursor: "pointer",
                                            padding: "5px 12px",
                                            borderRadius: 20,
                                            border: `1px solid rgba(148,163,184,0.2)`,
                                            background: "rgba(148,163,184,0.05)",
                                            transition: "all 150ms ease",
                                            height: 26,
                                            boxSizing: "border-box",
                                            display: "flex",
                                            alignItems: "center",
                                            userSelect: "none",
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.background = "rgba(148,163,184,0.1)"
                                            e.currentTarget.style.borderColor = "rgba(148,163,184,0.3)"
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.background = "rgba(148,163,184,0.05)"
                                            e.currentTarget.style.borderColor = "rgba(148,163,184,0.2)"
                                        }}
                                    >Disable All</div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                    {OV_GROUPS[ovTab].map(row => {
                                        const isOn = isFeatureOn(user.id, row.key as any, row.gk)
                                        const isOv = (user.overrides as any)[row.key] !== null && (user.overrides as any)[row.key] !== undefined
                                        return (
                                            <div key={row.key}
                                                onClick={() => setOv(row.key as any, !isOn)}
                                                style={{
                                                    background: "#313338",
                                                    borderRadius: 12,
                                                    border: `1px solid ${isOv ? "#5865f2" : "#3f4147"}`,
                                                    padding: "10px 12px",
                                                    cursor: "pointer",
                                                    transition: "border-color 150ms ease, background 150ms ease",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    height: 48,
                                                    boxSizing: "border-box",
                                                }}
                                                onMouseEnter={e => {
                                                    e.currentTarget.style.background = "#232428"
                                                    e.currentTarget.style.borderColor = isOv ? "#949cf4" : "#3f4147"
                                                }}
                                                onMouseLeave={e => {
                                                    e.currentTarget.style.background = "#313338"
                                                    e.currentTarget.style.borderColor = isOv ? "#5865f2" : "#3f4147"
                                                }}
                                            >
                                                <div style={{ color: isOn ? C.brand : C.muted, display: "flex", alignItems: "center", flexShrink: 0, position: "relative" }}>
                                                    {isOn && (
                                                        <span className="ur-pulse" style={{
                                                            position: "absolute",
                                                            top: -2, right: -2,
                                                            width: 6, height: 6,
                                                            borderRadius: "50%",
                                                            background: C.brand,
                                                            zIndex: 2,
                                                        }} />
                                                    )}
                                                    {row.key === "typing" && isOn ? (
                                                        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                                                            <span className="ur-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: C.brand, display: "inline-block" }} />
                                                            <span className="ur-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: C.brand, display: "inline-block" }} />
                                                            <span className="ur-typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: C.brand, display: "inline-block" }} />
                                                        </div>
                                                    ) : <row.Icon />}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 12, color: C.text, fontWeight: 600, userSelect: "none", lineHeight: 1.3 }}>
                                                        {row.label}
                                                        {isOv && (
                                                            <span style={{ color: C.brandLight, marginLeft: 4, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>
                                                                custom
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 10, color: C.muted, userSelect: "none", marginTop: 1, lineHeight: 1.2 }}>
                                                        {row.desc}
                                                    </div>
                                                </div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <div
                                                        role="button"
                                                        tabIndex={0}
                                                        title="preview notification"
                                                        onClick={(e: any) => { e.stopPropagation(); previewNotification(user.id, row.key) }}
                                                        onKeyDown={(e: any) => { if (e.key === "Enter") { e.stopPropagation(); previewNotification(user.id, row.key) } }}
                                                        style={{
                                                            color: C.muted,
                                                            cursor: "pointer",
                                                            width: 26,
                                                            height: 26,
                                                            borderRadius: 20,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            transition: "all 150ms cubic-bezier(0.4,0,0.2,1)",
                                                            flexShrink: 0,
                                                            background: C.bg1,
                                                            border: `1px solid ${C.border}`,
                                                        }}
                                                        onMouseEnter={e => {
                                                            e.currentTarget.style.background = `${C.brand}18`
                                                            e.currentTarget.style.borderColor = `${C.brand}60`
                                                            e.currentTarget.style.color = C.brandLight
                                                            e.currentTarget.style.transform = "scale(1.08)"
                                                        }}
                                                        onMouseLeave={e => {
                                                            e.currentTarget.style.background = C.bg1
                                                            e.currentTarget.style.borderColor = C.border
                                                            e.currentTarget.style.color = C.muted
                                                            e.currentTarget.style.transform = "scale(1)"
                                                        }}
                                                    >
                                                        <ico.preview />
                                                    </div>
                                                    <Toggle on={isOn} onChange={v => setOv(row.key as any, v)} />
                                                    {isOv && (
                                                        <div role="button" tabIndex={0} title="reset to global"
                                                            onClick={(e: any) => { e.stopPropagation(); setOv(row.key as any, null) }}
                                                            onKeyDown={(e: any) => { if (e.key === "Enter") { e.stopPropagation(); setOv(row.key as any, null) } }}
                                                            style={{ color: C.muted, cursor: "pointer", fontSize: 10, padding: "2px 3px", borderRadius: 4, userSelect: "none" }}
                                                            onMouseEnter={e => (e.currentTarget.style.background = C.hov)}
                                                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                                        >
                                                            ↩
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                                    <span
                                        onClick={resetAll}
                                        style={{
                                            fontSize: 11,
                                            color: C.muted,
                                            cursor: "pointer",
                                            fontWeight: 500,
                                            transition: "color 150ms ease",
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.color = C.danger}
                                        onMouseLeave={e => e.currentTarget.style.color = C.muted}
                                    >
                                        Reset to Default ↩
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

type SortMode = "az" | "date"

function createToolbarButton() {
    const btn = document.createElement("div")
    btn.id = "ur-toolbar-btn"
    btn.setAttribute("role", "button")
    btn.setAttribute("tabindex", "0")
    btn.setAttribute("aria-label", "UserRadar Watchlist")
    btn.title = "UserRadar Watchlist"
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
    btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;color:#b5bac1;margin:0 2px;border-radius:4px;transition:color 150ms ease,background 150ms ease;"
    btn.onclick = () => openModal(p => <WatchlistModal modalProps={p} />)
    btn.onmouseenter = () => { btn.style.color = "#ffffff"; btn.style.background = "rgba(255,255,255,0.1)" }
    btn.onmouseleave = () => { btn.style.color = "#b5bac1"; btn.style.background = "transparent" }
    return btn
}

let __urToolbarTimer: ReturnType<typeof setInterval> | null = null

function injectToolbarButton() {
    if (document.getElementById("ur-toolbar-btn")) return true
    const toolbar = document.querySelector('[class^="toolbar"], [class*="toolbar_"]') as HTMLElement
    if (!toolbar) return false
    const btn = createToolbarButton()
    const firstChild = toolbar.firstElementChild
    if (firstChild) {
        toolbar.insertBefore(btn, firstChild)
    } else {
        toolbar.appendChild(btn)
    }
    return true
}

function startToolbarObserver() {
    let attempts = 0
    const tryInject = () => {
        if (injectToolbarButton() || attempts++ > 30) {
            if (__urToolbarTimer) {
                clearInterval(__urToolbarTimer)
                __urToolbarTimer = null
            }
        }
    }
    tryInject()
    __urToolbarTimer = setInterval(tryInject, 500)
    const observer = new MutationObserver(() => {
        if (!document.getElementById("ur-toolbar-btn")) injectToolbarButton()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    ;(window as any).__urToolbarObserver = observer
}

function stopToolbarObserver() {
    if (__urToolbarTimer) {
        clearInterval(__urToolbarTimer)
        __urToolbarTimer = null
    }
    const observer = (window as any).__urToolbarObserver
    if (observer) {
        observer.disconnect()
        delete (window as any).__urToolbarObserver
    }
    const btn = document.getElementById("ur-toolbar-btn")
    if (btn) btn.remove()
}

function GlobalPresetControl({ refresh }: { refresh: () => void }) {
    const mode = settings.store.globalPresetMode || "custom"
    const presets = [
        { key: "custom",  label: "Custom",  desc: "Per-user control",         color: C.brand },
        { key: "stalker", label: "Stalker", desc: "Everything tracked",       color: C.danger },
        { key: "lite",    label: "Lite",    desc: "Essential tracking only",  color: C.brandLight },
        { key: "silent",  label: "Silent",  desc: "All notifications off",    color: "#b5bac1" }, // lighter gray for better active contrast
    ]
    const activeIndex = presets.findIndex(p => p.key === mode)

    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 10 }}>
                Global Preset Mode
            </div>

            <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${presets.length}, 1fr)`,
                background: C.bg1,
                borderRadius: 20,
                border: `1px solid ${C.border}`,
                padding: 4,
                position: "relative",
            }}>
                {/* Sliding active pill */}
                <div style={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    left: 4,
                    width: `calc((100% - 8px) / ${presets.length})`,
                    transform: `translateX(${activeIndex * 100}%)`,
                    background: presets[activeIndex].color + "20",
                    border: `1.5px solid ${presets[activeIndex].color}60`,
                    borderRadius: 16,
                    transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1), background 200ms ease, border-color 200ms ease",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                    zIndex: 1,
                }} />

                {presets.map(p => {
                    const isActive = mode === p.key
                    return (
                        <div
                            key={p.key}
                            onClick={() => { settings.store.globalPresetMode = p.key; refresh() }}
                            style={{
                                padding: "12px 6px",
                                borderRadius: 16,
                                cursor: "pointer",
                                textAlign: "center",
                                position: "relative",
                                zIndex: 2,
                                transition: "background 150ms ease",
                                userSelect: "none",
                            }}
                            onMouseEnter={e => {
                                if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)"
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                            }}
                        >
                            <div style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: isActive ? p.color : C.muted,
                                marginBottom: 4,
                                transition: "color 200ms ease",
                                whiteSpace: "nowrap",
                            }}>
                                {p.label}
                            </div>
                            <div style={{
                                fontSize: 10,
                                color: isActive ? C.text : C.muted,
                                opacity: isActive ? 1 : 0.6,
                                lineHeight: 1.3,
                                transition: "color 200ms ease, opacity 200ms ease",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                padding: "0 2px",
                            }}>
                                {p.desc}
                            </div>
                        </div>
                    )
                })}
            </div>

            {mode !== "custom" && (
                <div style={{
                    marginTop: 10,
                    padding: "10px 14px",
                    background: C.bg1,
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    fontSize: 12,
                    color: C.muted,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}>
                    <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: presets[activeIndex].color,
                        flexShrink: 0,
                    }} />
                    <span>
                        All users follow the <b style={{ color: presets[activeIndex].color }}>{presets[activeIndex].label}</b> preset. Individual overrides are disabled. Switch to <b style={{ color: C.brand, cursor: "pointer" }} onClick={() => { settings.store.globalPresetMode = "custom"; refresh() }}>Custom</b> to configure per-user.
                    </span>
                </div>
            )}
        </div>
    )
}

// updater — check github for new commits, download and write to disk, prompt restart
// using VencordNative.ipc which is the same channel Vencord's own updater uses
const PLUGIN_RAW_URL     = "https://raw.githubusercontent.com/k1ng0p/UserRadar/main/index.tsx"
const PLUGIN_COMMITS_URL = "https://api.github.com/repos/k1ng0p/UserRadar/commits?path=index.tsx&per_page=1"

// this is the full sha of the commit this file was built from
// the updater fetches the latest commit sha from github and compares against this
// if they differ = update available, no date math, no version strings to forget to bump
// UPDATE THIS after every install — copy the sha from github after pushing
const INSTALLED_SHA = "none"

type UpdateState = "idle" | "checking" | "uptodate" | "available" | "downloading" | "done" | "error"

async function checkUpdate(): Promise<{ hasUpdate: boolean; sha: string; shortSha: string; date: string }> {
    const res = await fetch(PLUGIN_COMMITS_URL, {
        headers: { Accept: "application/vnd.github.v3+json" },
        cache: "no-store",
    })
    if (!res.ok) throw new Error(`github api error ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data) || !data[0]) throw new Error("no commits found")
    const latestSha  = data[0].sha as string
    const shortSha   = latestSha.slice(0, 7)
    const date       = (data[0].commit?.committer?.date ?? "").slice(0, 10)
    // any sha mismatch = update available
    // "none" always triggers so first-run users always see the update prompt
    const hasUpdate  = latestSha !== INSTALLED_SHA && INSTALLED_SHA !== latestSha
    return { hasUpdate, sha: latestSha, shortSha, date }
}

async function downloadAndInstall(): Promise<void> {
    // fetch latest sha + raw file in parallel
    const [commitRes, fileRes] = await Promise.all([
        fetch(PLUGIN_COMMITS_URL, { headers: { Accept: "application/vnd.github.v3+json" }, cache: "no-store" }),
        fetch(PLUGIN_RAW_URL + "?t=" + Date.now(), { cache: "no-store" }),
    ])
    if (!commitRes.ok) throw new Error(`github ${commitRes.status}`)
    if (!fileRes.ok)   throw new Error(`download ${fileRes.status}`)
    const commitData = await commitRes.json()
    const latestSha  = commitData[0]?.sha ?? "none"
    let code = await fileRes.text()
    if (!code || code.length < 500) throw new Error("bad response")
    // stamp the sha into the installed file so next check is accurate
    code = code.replace(/const INSTALLED_SHA = ".*?"/, `const INSTALLED_SHA = "${latestSha}"`)

    // Vencord's native IPC — same thing the built-in updater uses internally
    // path is relative to the settings dir / userplugins folder
    const native = (window as any).VencordNative

    // try the ipc invoke approach first (most reliable)
    if (native?.ipc?.invoke) {
        try {
            const dir = await native.settings.getSettingsDir()
            const path = `${dir}/userplugins/UserRadar/index.tsx`
            await native.ipc.invoke("VencordWriteFile", path, code)
            return
        } catch { }
        try {
            // some builds expose it differently
            await native.ipc.invoke("writeFile", "userplugins/UserRadar/index.tsx", code)
            return
        } catch { }
    }

    // fallback: node fs via discord's preload (works on older vencord builds)
    const req = (window as any).require
    if (req) {
        try {
            const fs   = req("fs")
            const path = req("path")
            // find the plugin file — __filename isn't available but we can get it from the stack
            const native2 = (window as any).VencordNative
            const dir = await native2?.settings?.getSettingsDir?.()
            if (dir) {
                fs.writeFileSync(path.join(dir, "userplugins", "UserRadar", "index.tsx"), code, "utf8")
                return
            }
        } catch { }
    }

    throw new Error("can't write file — no native access")
}

function relaunchDiscord() {
    try { (window as any).DiscordNative?.app?.relaunch?.() } catch { }
    try { (window as any).VencordNative?.native?.relaunch?.() } catch { }
}

function WatchlistModal({ modalProps }: { modalProps: any }) {
    React.useEffect(() => { injectStyles() }, [])

    const [users, setUsers]       = React.useState<WatchedUser[]>(() => { try { return getWatchlist(settings) } catch { return [] } })
    const [query, setQuery]       = React.useState("")
    const [sort,  setSort]        = React.useState<SortMode>("date")
    const [expandedId, setExpandedId] = React.useState<string | null>(null)

    const [updateState, setUpdateState] = React.useState<UpdateState>("idle")
    const [updateInfo,  setUpdateInfo]  = React.useState<{ sha: string; date: string } | null>(null)
    const [updateErr,   setUpdateErr]   = React.useState("")

    const handleCheckUpdate = () => {
        setUpdateState("checking")
        setUpdateErr("")
        checkUpdate().then(info => {
            if (info.hasUpdate) {
                setUpdateInfo({ sha: info.shortSha, date: info.date })
                setUpdateState("available")
            } else {
                setUpdateState("uptodate")
            }
        }).catch(e => {
            setUpdateErr(e?.message ?? "unknown error")
            setUpdateState("error")
        })
    }

    const handleInstall = () => {
        setUpdateState("downloading")
        downloadAndInstall().then(() => {
            setUpdateState("done")
        }).catch(e => {
            setUpdateErr(e?.message ?? "install failed")
            setUpdateState("error")
        })
    }

    const refresh = () => { try { setUsers(getWatchlist(settings)) } catch { setUsers([]) } }

    const shown = React.useMemo(() => {
        let list = users.filter(u => {
            if (!query.trim()) return true
            const q  = query.toLowerCase()
            const du = UserStore.getUser(u.id)
            return [displayName(du), u.nick ?? "", u.id].join(" ").toLowerCase().includes(q)
        })
        return sort === "az"
            ? [...list].sort((a, b) => (displayName(UserStore.getUser(a.id)) || a.id).localeCompare(displayName(UserStore.getUser(b.id)) || b.id))
            : [...list].sort((a, b) => b.addedAt - a.addedAt)
    }, [users, query, sort])

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader separator={false}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        background: C.brandGrad,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        boxShadow: "0 2px 8px rgba(88,101,242,0.3)",
                    }}>
                        <ico.eye />
                    </div>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>UserRadar</div>
                        <div style={{ fontSize: 12, color: C.muted }}>watchlist manager</div>
                    </div>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent>
                <div className="ur-scrollbar" style={{ padding: "0 16px", maxHeight: "60vh", overflowY: "auto" }}>
                    <AddUserSection onAdded={refresh} />

                    <div style={{ height: 1, background: C.border, margin: "18px 0" }} />

                    <GlobalPresetControl refresh={refresh} />

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader }}>
                            watchlist <span style={{ fontWeight: 500, color: C.muted }}>({users.length})</span>
                        </div>

                        <div role="button" tabIndex={0}
                            onClick={() => setSort(s => s === "az" ? "date" : "az")}
                            title={sort === "az" ? "sort by date" : "sort a-z"}
                            style={{
                                display: "flex", alignItems: "center", gap: 4,
                                padding: "0 9px",
                                borderRadius: 20,
                                cursor: "pointer",
                                background: C.bg2,
                                border: `1px solid ${C.border}`,
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 600,
                                userSelect: "none",
                                height: 28,
                                boxSizing: "border-box",
                                overflow: "hidden",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = C.bgEl)}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
                        >
                            {sort === "az" ? <ico.sortAz /> : <ico.sortDate />}
                            {sort === "az" ? "a-z" : "newest"}
                        </div>

                        <SearchInput query={query} setQuery={setQuery} />
                    </div>

                    {users.length === 0 && (
                        <div className="ur-fade-in" style={{ textAlign: "center", padding: "48px 0" }}>
                            <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, color: C.muted }}><ico.ghost /></div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: C.header }}>nobody here yet</div>
                            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>add someone above to start tracking them</div>
                        </div>
                    )}

                    {shown.length === 0 && users.length > 0 && (
                        <div className="ur-fade-in" style={{ textAlign: "center", padding: "32px 0", fontSize: 13, color: C.muted }}>
                            no results for "<b>{query}</b>"
                        </div>
                    )}

                    {shown.map(u => (
                        <WatchedRow
                        key={u.id}
                        user={u}
                        refresh={refresh}
                        expandedId={expandedId}
                        setExpandedId={setExpandedId}
                        onRemove={() => { removeUser(settings, u.id); refresh() }}
                    />
                    ))}
                </div>
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", gap: 10 }}>

                    {/* left side — updater */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>

                        {/* check / install / restart button */}
                        <button
                            disabled={updateState === "checking" || updateState === "downloading"}
                            onClick={() => {
                                if (updateState === "idle" || updateState === "uptodate" || updateState === "error") handleCheckUpdate()
                                else if (updateState === "available") handleInstall()
                                else if (updateState === "done") relaunchDiscord()
                            }}
                            style={{
                                display: "flex", alignItems: "center", gap: 6,
                                borderRadius: 20, height: 32, padding: "0 14px",
                                boxSizing: "border-box", fontFamily: "inherit",
                                fontSize: 12, fontWeight: 600, cursor: "pointer",
                                border: `1px solid ${
                                    updateState === "available"                     ? C.brand :
                                    updateState === "done"                          ? C.green :
                                    updateState === "error"                         ? C.red   :
                                    C.border
                                }`,
                                background:
                                    updateState === "available"                     ? "rgba(88,101,242,0.15)" :
                                    updateState === "done"                          ? "rgba(36,128,70,0.15)"  :
                                    updateState === "error"                         ? "rgba(218,55,60,0.1)"   :
                                    "transparent",
                                color:
                                    updateState === "available"                     ? C.brand      :
                                    updateState === "done"                          ? C.green      :
                                    updateState === "error"                         ? C.red        :
                                    updateState === "uptodate"                      ? C.green      :
                                    C.muted,
                                opacity: (updateState === "checking" || updateState === "downloading") ? 0.6 : 1,
                                transition: "all 150ms ease",
                            }}
                        >
                            {(updateState === "checking" || updateState === "downloading") && (
                                <span className="ur-spin" style={{ width: 10, height: 10 }} />
                            )}
                            {updateState === "idle"        && "check for updates"}
                            {updateState === "checking"    && "checking…"}
                            {updateState === "uptodate"    && "✓ up to date"}
                            {updateState === "available"   && `↓ install update  (${updateInfo?.sha})`}
                            {updateState === "downloading" && "installing…"}
                            {updateState === "done"        && "↺ restart discord"}
                            {updateState === "error"       && "⚠ retry"}
                        </button>

                        {/* contextual hint text */}
                        {updateState === "available" && updateInfo && (
                            <span style={{ fontSize: 11, color: C.muted }}>
                                {updateInfo.date}
                            </span>
                        )}
                        {updateState === "done" && (
                            <span style={{ fontSize: 11, color: C.muted }}>
                                saved — restart to apply
                            </span>
                        )}
                        {updateState === "error" && updateErr && (
                            <span style={{ fontSize: 11, color: C.red }} title={updateErr}>
                                {updateErr.length > 40 ? updateErr.slice(0, 40) + "…" : updateErr}
                            </span>
                        )}
                    </div>

                    {/* right side — close button */}
                    <button
                        onClick={modalProps.onClose}
                        style={{
                            borderRadius: 20, height: 32, boxSizing: "border-box",
                            padding: "0 16px", background: "transparent", color: C.text,
                            border: `1px solid ${C.border}`, fontSize: 13, fontWeight: 500,
                            cursor: "pointer", fontFamily: "inherit",
                            transition: "background 150ms, border-color 150ms, color 150ms",
                            flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.brand; e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.color = "#fff" }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.text }}
                    >
                        close
                    </button>
                </div>
            </ModalFooter>
        </ModalRoot>
    )
}

// context menu patches

const userCtxPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user) return
    const isW = isWatched(settings, user.id)
    const idx = children.findIndex(c => c?.props?.id === "user-context-devmode-copy-id")
    children.splice(idx >= 0 ? idx + 1 : children.length, 0,
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="ur-watch"
                label={isW ? "remove from watchlist" : "add to watchlist"}
                action={() => {
                    if (isW) { removeUser(settings, user.id); Toasts.show({ type: Toasts.Type.DEFAULT, message: `removed ${displayName(user)} from watchlist`, id: Toasts.genId() }) }
                    else { addUser(settings, user.id); Toasts.show({ type: Toasts.Type.SUCCESS, message: `added ${displayName(user)} to watchlist`, id: Toasts.genId() }) }
                }}
                icon={isW ? CtxEyeOffIcon : CtxEyeIcon}
            />
            <Menu.MenuItem
                id="ur-config"
                label="configure watchlist"
                action={() => openModal(p => <WatchlistModal modalProps={p} />)}
                icon={CtxGearIcon}
            />
        </Menu.MenuGroup>
    )
}

const msgCtxPatch: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message?.author) return
    const isW = isWatched(settings, message.author.id)
    const idx = children.findIndex(c => c?.props?.id === "message-devmode-copy-id")
    children.splice(idx >= 0 ? idx + 1 : children.length, 0,
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="ur-msg-watch"
                label={isW ? "remove author from watchlist" : "add author to watchlist"}
                action={() => {
                    if (isW) { removeUser(settings, message.author.id); Toasts.show({ type: Toasts.Type.DEFAULT, message: `removed ${displayName(message.author)} from watchlist`, id: Toasts.genId() }) }
                    else { addUser(settings, message.author.id); Toasts.show({ type: Toasts.Type.SUCCESS, message: `added ${displayName(message.author)} to watchlist`, id: Toasts.genId() }) }
                }}
                icon={isW ? CtxEyeOffIcon : CtxEyeIcon}
            />
        </Menu.MenuGroup>
    )
}

// the plugin itself

export default definePlugin({
    name: "UserRadar",
    description: "track watched users and get notified on messages, edits, deletes, typing, profile/avatar changes, voice, status, activity, boosts, and server joins",
    authors: [{ name: "k1ng_op", id: 1337n }],
    dependencies: ["MessageLoggerEnhanced"],

    settings,

    start() {
        addContextMenuPatch("user-context", userCtxPatch)
        addContextMenuPatch("message", msgCtxPatch)
        if (settings.store.showToolbarIcon) startToolbarObserver()

        // pre-populate all caches BEFORE flux events start arriving
        // if we don't do this, the first VOICE_STATE_UPDATES looks like a join even if they were already in vc
        try {
            const vsMod    = findByProps("getVoiceStateForUser")
            const presMod  = findByProps("getStatus", "getActivities")
            const guildMod = findByProps("getGuildIds", "getGuild")
            const memMod   = findByProps("getMember", "isMember")
            const allGuilds: string[] = guildMod?.getGuildIds?.() ?? []

            for (const wu of getWatchlist(settings)) {
                // voice
                try {
                    const vs = vsMod?.getVoiceStateForUser?.(wu.id)
                    vcCache[wu.id] = vs?.channelId ?? null
                } catch { vcCache[wu.id] = null }

                // status + activity
                try {
                    const status = presMod?.getStatus?.(wu.id)
                    if (status) statusCache[wu.id] = status
                    const acts: any[] = presMod?.getActivities?.(wu.id) ?? []
                    const realAct = acts.find((a: any) => a.type !== 4) ?? null
                    activityCache[wu.id] = realAct ? `${realAct.type}:${realAct.name}` : null
                } catch { }

                // guild membership
                try {
                    if (memMod && allGuilds.length) {
                        guildCache[wu.id] = new Set(
                            allGuilds.filter(gid => { try { return memMod.isMember(gid, wu.id) } catch { return false } })
                        )
                    }
                } catch { }
            }
        } catch (e) { log.warn("snapshot failed", e) }

        // fetch baseline profiles in background — staggered so we don't get ratelimited
        // using setTimeout(fetchNext) instead of await-in-loop so start() returns fast
        const list = getWatchlist(settings)
        let i = 0
        const fetchNext = () => {
            if (i >= list.length) return
            const wu = list[i++]
            RestAPI.get({
                url: `/users/${wu.id}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            }).then((res: any) => {
                profileCache[wu.id] = camelize(res.body)
                setTimeout(fetchNext, 800)  // stagger requests
            }).catch(() => setTimeout(fetchNext, 800))
        }
        setTimeout(fetchNext, 500)  // small delay so discord finishes its own startup first

        pollTimer = setInterval(pollProfiles, 5 * 60 * 1000)
    },

    stop() {
        removeContextMenuPatch("user-context", userCtxPatch)
        removeContextMenuPatch("message", msgCtxPatch)
        stopToolbarObserver()
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        Object.keys(profileCache).forEach(k => delete profileCache[k])
        Object.keys(vcCache).forEach(k => delete vcCache[k])
        Object.keys(statusCache).forEach(k => delete statusCache[k])
        Object.keys(activityCache).forEach(k => delete activityCache[k])
        Object.keys(guildCache).forEach(k => delete guildCache[k])
        loggedMsgs = null
    },

    flux: {
        MESSAGE_CREATE({ optimistic, type, message, channelId }: MsgCreateEvent) {
            if (optimistic || type !== "MESSAGE_CREATE") return
            const uid = message.author?.id
            if (!uid || !isWatched(settings, uid)) return
            if (isFeatureOn(uid, "msgs", "globalMsgs")) {
                const label = getWatchedUser(settings, uid)?.nick
                const name  = displayName(message.author)
                const dn    = label ? `${label} (${name})` : name
                const ch    = ChannelStore.getChannel(channelId)
                const g     = ch?.guild_id ? findByProps("getGuild").getGuild(ch.guild_id) : null
                const chName = ch?.name || "dm"
                const gName = g?.name || ""
                const location = gName ? `${gName} · #${chName}` : `DM · #${chName}`
                if (settings.store.skipCurrentChannel) {
                    const cur = getCurrentChannel()
                    if (cur?.id === channelId) return
                }
                notify({
                    title: `${dn} sent a message`,
                    body: msgPreview(message.content, message.attachments?.[0]?.filename),
                    icon: avatarUrl(uid, message.author?.avatar, 80),
                    onClick: () => jumpTo(ch?.guild_id, channelId, message.id),
                })
                logActivity(uid, "msg", "💬", `sent a message in ${location}`, ch?.guild_id, channelId, message.id)
            }
        },

        MESSAGE_UPDATE({ message }: MsgUpdateEvent) {
            const uid = message?.author?.id
            if (!uid || !isWatched(settings, uid)) return

            // edited_timestamp only exists on real user edits
            // embed resolution / pin events / reaction updates also fire MESSAGE_UPDATE but don't have this
            if (!message.edited_timestamp) return

            if (!isFeatureOn(uid, "edits", "globalEdits")) return

            const label = getWatchedUser(settings, uid)?.nick
            const name  = displayName(message.author)
            const dn    = label ? `${label} (${name})` : name
            const ch    = ChannelStore.getChannel(message.channel_id)
            const g     = ch?.guild_id ? findByProps("getGuild")?.getGuild(ch.guild_id) : null
            const chName = ch?.name || "dm"
            const gName  = g?.name || ""
            const location = gName ? `${gName} · #${chName}` : `DM · #${chName}`

            if (settings.store.skipCurrentChannel && getCurrentChannel()?.id === message.channel_id) return

            // try to get old content from cache for before → after preview
            // MessageStore still has the old version at the time MESSAGE_UPDATE fires
            const cached = MessageStore.getMessage(message.channel_id, message.id)
            const before = cached?.content && cached.content !== message.content
                ? `"${trunc(cached.content, 60)}" → `
                : ""
            const after = message.content
                ? `"${trunc(message.content, 60)}"`
                : "click to view"

            notify({
                title: `${dn} edited a message`,
                body: `${before}${after}`,
                icon: avatarUrl(uid, message.author?.avatar, 80),
                onClick: () => jumpTo(ch?.guild_id, message.channel_id, message.id),
            })
            logActivity(uid, "edit", "✏️", `edited a message in ${location}`, ch?.guild_id, message.channel_id, message.id)
        },

        MESSAGE_DELETE({ id, channelId }: MsgDeleteEvent) {
            const store = tryLoadLoggedMsgs()
            // discord cache first, then try message logger in both key formats it uses
            const msg = MessageStore.getMessage(channelId, id)
                ?? store?.[id]
                ?? (store as any)?.[channelId]?.[id]
            if (!msg?.author) return
            const uid = msg.author.id
            if (!isWatched(settings, uid)) return
            if (isFeatureOn(uid, "deletes", "globalDeletes")) {
                const label = getWatchedUser(settings, uid)?.nick
                const name  = displayName(msg.author)
                const dn    = label ? `${label} (${name})` : name
                const ch    = ChannelStore.getChannel(channelId)
                const g     = ch?.guild_id ? findByProps("getGuild").getGuild(ch.guild_id) : null
                const chName = ch?.name || "dm"
                const gName = g?.name || ""
                const location = gName ? `${gName} · #${chName}` : `DM · #${chName}`
                if (settings.store.skipCurrentChannel) {
                    const cur = getCurrentChannel()
                    if (cur?.id === channelId) return
                }
                notify({
                    title: `${dn} deleted a message`,
                    body: msgPreview(msg.content, msg.attachments?.[0]?.filename),
                    icon: avatarUrl(uid, msg.author?.avatar, 80),
                    onClick: () => jumpTo(ch?.guild_id, channelId, msg.id),
                })
                logActivity(uid, "delete", "🗑️", `deleted a message in ${location}`, ch?.guild_id, channelId, msg.id)
            }
        },

        TYPING_START({ channelId, userId }: TypingEvent) {
            if (!isWatched(settings, userId)) return
            if (isFeatureOn(userId, "typing", "globalTyping")) {
                const label = getWatchedUser(settings, userId)?.nick
                const u     = UserStore.getUser(userId)
                const name  = displayName(u) || userId
                const dn    = label ? `${label} (${name})` : name
                const ch    = ChannelStore.getChannel(channelId)
                const g     = ch?.guild_id ? findByProps("getGuild").getGuild(ch.guild_id) : null
                const chName = ch?.name || "dm"
                const gName = g?.name || ""
                const location = gName ? `${gName} · #${chName}` : `DM · #${chName}`
                if (settings.store.skipCurrentChannel) {
                    const cur = getCurrentChannel()
                    if (cur?.id === channelId) return
                }
                notify({
                    title: `${dn} is typing…`,
                    body: `in ${location}`,
                    icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                    onClick: () => jumpTo(ch?.guild_id, channelId),
                })
                logActivity(userId, "typing", "💭", `is typing in ${location}`, ch?.guild_id, channelId)
            }
        },

        VOICE_STATE_UPDATES({ voiceStates }: VoiceStateEvent) {
            for (const vs of voiceStates || []) {
                const uid = vs.userId
                if (!isWatched(settings, uid)) continue
                const old = vcCache[uid]
                const now = vs.channelId || null
                if (old === undefined) { vcCache[uid] = now; continue }
                if (old === now) continue
                vcCache[uid] = now
                if (!isFeatureOn(uid, "voice", "globalVoice")) continue
                const label = getWatchedUser(settings, uid)?.nick
                const u     = UserStore.getUser(uid)
                const name  = displayName(u) || uid
                const dn    = label ? `${label} (${name})` : name
                const ch    = now ? ChannelStore.getChannel(now) : (old ? ChannelStore.getChannel(old) : null)
                const chName = ch?.name || "unknown"
                const action = !old && now ? "joined" : old && !now ? "left" : "moved in"
                notify({
                    title: `${dn} ${action} voice`,
                    body: `#${chName}`,
                    icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                    onClick: () => { if (now) jumpTo(ch?.guild_id, now) },
                })
                logActivity(uid, "voice", "🎙️", `${action} voice in #${chName}`, ch?.guild_id, now || old)
            }
        },

        PRESENCE_UPDATES({ updates }: PresenceEvent) {
            for (const u of updates || []) {
                const uid = u.user?.id
                if (!uid || !isWatched(settings, uid)) continue
                const oldStatus = statusCache[uid]
                const newStatus = u.status
                if (oldStatus !== undefined && oldStatus !== newStatus && isFeatureOn(uid, "status", "globalStatus")) {
                    const label = getWatchedUser(settings, uid)?.nick
                    const user  = UserStore.getUser(uid)
                    const name  = displayName(user) || uid
                    const dn    = label ? `${label} (${name})` : name
                    notify({
                        title: `${dn} is now ${newStatus}`,
                        body: `was: ${oldStatus}`,
                        icon: user ? avatarUrl(user.id, (user as any).avatar, 80) : undefined,
                        onClick: () => openUserProfile(uid),
                    })
                    logActivity(uid, "status", STATUS_EMOJI[newStatus] || "🔵", `status changed to ${newStatus} (was ${oldStatus})`)
                }
                statusCache[uid] = newStatus
                // type 4 = custom status (just emoji + text), skip it
                // only care about real activities: playing (0), listening (2), watching (3), competing (5)
                const realAct = (u.activities || []).find((a: any) => a.type !== 4) ?? null
                const newActKey = realAct ? `${realAct.type}:${realAct.name}` : null
                const oldAct = activityCache[uid]

                if (oldAct !== undefined && oldAct !== newActKey && isFeatureOn(uid, "activity", "globalActivity")) {
                    const ACT_VERB: Record<number, string> = { 0: "playing", 2: "listening to", 3: "watching", 5: "competing in" }
                    const label = getWatchedUser(settings, uid)?.nick
                    const user  = UserStore.getUser(uid)
                    const name  = displayName(user) || uid
                    const dn    = label ? `${label} (${name})` : name
                    if (realAct) {
                        const verb = ACT_VERB[realAct.type] ?? "playing"
                        notify({
                            title: `${dn} is ${verb} ${realAct.name}`,
                            body: realAct.details || realAct.state || "",
                            icon: user ? avatarUrl(user.id, (user as any).avatar, 80) : undefined,
                            onClick: () => openUserProfile(uid),
                        })
                        logActivity(uid, "activity", "🎮", `${verb} ${realAct.name}`)
                    } else if (oldAct) {
                        const [typeStr, ...nameParts] = oldAct.split(":")
                        const oldName = nameParts.join(":")
                        const verb = ACT_VERB[parseInt(typeStr)] ?? "playing"
                        notify({
                            title: `${dn} stopped ${verb} ${oldName}`,
                            body: "",
                            icon: user ? avatarUrl(user.id, (user as any).avatar, 80) : undefined,
                            onClick: () => openUserProfile(uid),
                        })
                        logActivity(uid, "activity", "🛑", `stopped ${verb} ${oldName}`)
                    }
                }
                activityCache[uid] = newActKey
            }
        },

        // discord pushes username/avatar changes instantly over ws — fastest path for those fields
        USER_UPDATE({ user }: { user: any }) {
            if (!user?.id || !isWatched(settings, user.id)) return
            const old = profileCache[user.id]
            if (!old) return
            checkProfileChanged(user.id, { ...old, user: { ...old.user, ...camelize(user) } })
        },

        // fires when discord fetches a full profile (opening someone's card, profile page etc)
        USER_PROFILE_FETCH_SUCCESS(rawEvt: any) {
            if (!rawEvt?.user?.id) return
            checkProfileChanged(rawEvt.user.id, camelize(rawEvt))
        },

        // only fires for servers you're in — that's fine, if you're not in the server you won't see it
        // wasIn check prevents false positives on discord reconnect re-sync
        GUILD_MEMBER_ADD({ guildId, user }: GuildMemberEvent) {
            if (!user?.id || !isWatched(settings, user.id)) return
            if (!guildCache[user.id]) guildCache[user.id] = new Set()
            const wasIn = guildCache[user.id].has(guildId)
            guildCache[user.id].add(guildId)
            if (!wasIn && isFeatureOn(user.id, "joins", "globalJoins")) {
                const g = findByProps("getGuild").getGuild(guildId)
                const label = getWatchedUser(settings, user.id)?.nick
                const name  = displayName(user)
                const dn    = label ? `${label} (${name})` : name
                notify({
                    title: `${dn} joined a server`,
                    body: g?.name || guildId,
                    icon: avatarUrl(user.id, user.avatar, 80),
                    onClick: () => jumpTo(guildId),
                })
                logActivity(user.id, "join", "📥", `joined ${g?.name || guildId}`, guildId)
            }
        },

        GUILD_MEMBER_REMOVE({ guildId, user }: GuildMemberEvent) {
            if (!user?.id || !isWatched(settings, user.id)) return
            if (!guildCache[user.id]) guildCache[user.id] = new Set()
            const wasIn = guildCache[user.id].has(guildId)
            guildCache[user.id].delete(guildId)
            if (wasIn && isFeatureOn(user.id, "joins", "globalJoins")) {
                const g = findByProps("getGuild").getGuild(guildId)
                const label = getWatchedUser(settings, user.id)?.nick
                const name  = displayName(user)
                const dn    = label ? `${label} (${name})` : name
                notify({
                    title: `${dn} left a server`,
                    body: g?.name || guildId,
                    icon: avatarUrl(user.id, user.avatar, 80),
                    onClick: () => jumpTo(guildId),
                })
                logActivity(user.id, "leave", "📤", `left ${g?.name || guildId}`, guildId)
            }
        },

        GUILD_BOOST_CREATE({ guildId, userId }: any) {
            if (!userId || !isWatched(settings, userId)) return
            if (isFeatureOn(userId, "boosts", "globalBoosts")) {
                const g = findByProps("getGuild").getGuild(guildId)
                const u = UserStore.getUser(userId)
                const label = getWatchedUser(settings, userId)?.nick
                const name  = displayName(u) || userId
                const dn    = label ? `${label} (${name})` : name
                notify({
                    title: `${dn} boosted a server`,
                    body: g?.name || guildId,
                    icon: u ? avatarUrl(u.id, (u as any).avatar, 80) : undefined,
                    onClick: () => jumpTo(guildId),
                })
                logActivity(userId, "boost", "🚀", `boosted ${g?.name || guildId}`, guildId)
            }
        },
    },
})
