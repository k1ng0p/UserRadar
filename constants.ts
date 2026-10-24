import type { ActivityType } from "./activityStore"

export const STATUS_EMOJI_LOCAL: Record<string, string> = {
    online: "🟢",
    idle: "🌙",
    dnd: "🔴",
    offline: "⚫",
    invisible: "⚫",
}

export const LEGACY_LOG_KEY = "UserRadar_ActivityLog_v2"

export const LOG_KEY_PREFIX = "UserRadar_ActivityLog_v3_"

export const MAX_LOGS_HARD_CAP = 50000

export const SAVE_DELAY_MS = 1500

export const LITE_FEATURES = ["msgs", "deletes", "typing", "avatar", "voice", "status"]

export const TYPING_LOG_TTL_MS = 3 * 60 * 1000

// persisted so a discord restart doesn't orphan whatever was mid-session
export const ACTIVE_SESSIONS_KEY = "UserRadar_ActiveSessions_v1"

export const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000  // 24h — a session stuck this long means the close event never arrived (client crash, force quit, etc)

export const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Away", dnd: "Do Not Disturb", offline: "Offline", invisible: "Invisible" }

export const ACT_VERB: Record<number, string> = { 0: "playing", 2: "listening to", 3: "watching", 5: "competing in" }

export const isOfflineStatus = (s: string) => s === "offline" || s === "invisible"

export const FALLBACK_AV = "https://cdn.discordapp.com/embed/avatars/0.png"

export const PROFILE_TEXT = ["username", "globalName", "bio", "banner", "pronouns"] as const

export const FIELD_NAME: Record<string, string> = {
    username: "username", globalName: "display name",
    bio: "about me", banner: "banner", pronouns: "pronouns",
}

export const PROFILE_TYPE_MAP: Record<string, ActivityType> = {
    username: "username",
    globalName: "displayname",
    bio: "bio",
    banner: "banner",
    pronouns: "pronouns",
}

export const PROFILE_ICON_MAP: Record<string, string> = {
    username: "🏷️",
    globalName: "📛",
    bio: "📝",
    banner: "🏳️",
    pronouns: "🪪",
}

export const CLIENT_EMOJI: Record<string, string> = {
    desktop:  "💻",
    mobile:   "📱",
    web:      "🌐",
    embedded: "🎮",
    vr:       "🥽",
}

export const CLIENT_LABEL_MAP: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", web: "Web", embedded: "Console", vr: "VR" }
