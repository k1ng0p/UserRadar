import { definePluginSettings } from "@api/Settings"
import { OptionType } from "@utils/types"

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/

export const settings = definePluginSettings({
    watchlist:          { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "watchlist json — managed by the ui, don't touch" },
    globalPresetMode:   { type: OptionType.STRING,  hidden: true,  default: "custom",               description: "global preset mode" },
    installedSha:       { type: OptionType.STRING,  hidden: true,  default: "none",  description: "installed commit sha" },
    globalMsgs:         { type: OptionType.BOOLEAN, default: true,                   description: "messages" },
    globalEdits:        { type: OptionType.BOOLEAN, default: true,                   description: "edits" },
    globalDeletes:      { type: OptionType.BOOLEAN, default: true,                   description: "deletes (needs msg-logger-enhanced)" },
    globalTyping:       { type: OptionType.BOOLEAN, default: true,                   description: "typing" },
    globalProfile:      { type: OptionType.BOOLEAN, default: true,                   description: "profile changes" },
    globalAvatar:       { type: OptionType.BOOLEAN, default: true,                   description: "avatar changes" },
    globalVoice:        { type: OptionType.BOOLEAN, default: true,                   description: "voice" },
    globalStatus:       { type: OptionType.BOOLEAN, default: false,                  description: "status (spammy)" },
    globalActivity:     { type: OptionType.BOOLEAN, default: false,                  description: "activity changes (spammy)" },
    globalJoins:        { type: OptionType.BOOLEAN, default: true,                   description: "server joins/leaves" },
    showPreview:        { type: OptionType.BOOLEAN, default: true,                   description: "show message preview" },
    previewLen:         { type: OptionType.NUMBER,  default: 120,                  description: "preview length (0 = unlimited)" },
    quietHours:         { type: OptionType.BOOLEAN, default: false,                  description: "quiet hours" },
    quietStart:         { type: OptionType.STRING,  default: "23:00",                description: "quiet hours start (24h, e.g. 23:00)", isValid: (v: string) => TIME_RE.test(v) || "use 24h HH:MM, like 23:00" },
    quietEnd:           { type: OptionType.STRING,  default: "07:00",                description: "quiet hours end (24h, e.g. 07:00)", isValid: (v: string) => TIME_RE.test(v) || "use 24h HH:MM, like 07:00" },
    skipCurrentChannel: { type: OptionType.BOOLEAN, default: true,                   description: "skip if already in that channel" },
    maxLogsPerUser:     { type: OptionType.NUMBER,  default: 500,                    description: "max logs per user (0 = 50000)" },
    pinnedUsers:        { type: OptionType.STRING,  hidden: true,  default: "[]",    description: "pinned watchlist user ids" },
    compactLogView:     { type: OptionType.BOOLEAN, default: false,                  description: "compact activity log cards" },
    autoCleanupLogs:    { type: OptionType.BOOLEAN, default: true,                   description: "delete logs when removing a user from watchlist" },
    debugLog:           { type: OptionType.BOOLEAN, default: false,                  description: "debug logging" },
    showToolbarIcon:    { type: OptionType.BOOLEAN, default: true,                   restartNeeded: true, description: "toolbar icon" },
    logVcMembers:       { type: OptionType.BOOLEAN, default: false,                  description: "also log names of other people in the voice channel (privacy: logs non-watched users too)" },
})
