import { React } from "@webpack/common"
import type { JSX } from "react"

import { _albumColorCache, appIconCache, extractAlbumColor, fetchAppIcon, MUSIC_APP_ICONS } from "../activityMedia"
import { ActivityEntry, activityStore, ActivityType } from "../activityStore"
import { CLIENT_EMOJI, CLIENT_LABEL_MAP, FIELD_NAME } from "../constants"
import { activeSessions } from "../sessions"
import { exactTime, formatDuration, hexToRgba, jumpTo, timeAgo, trunc } from "../utils"
import { actIco, ico } from "./icons"
import { C } from "./theme"

export function getActivityIconKey(entry: ActivityEntry): keyof typeof actIco {
    const type = entry.type
    const meta = entry.metadata || {}

    // exact type first so a msg containing "spotify" isn't mis-tagged
    if (type === "msg") return "message"
    if (type === "edit") return "edit"
    if (type === "delete") return "delete"
    if (type === "typing") return "typing"
    if (type === "profile") return "profile"
    if (type === "avatar") return "avatar"
    if (type === "banner") return "banner"
    if (type === "bio") return "bio"
    if (type === "username" || type === "displayname") return "username"
    if (type === "pronouns") return "pronouns"
    if (type === "custom_status") return "customStatus"
    if (type === "join") return "join"
    if (type === "leave") return "leave"
    if (type === "vc_move") return "vcMove"
    if (type === "game_start" || type === "game_stop") return "playing"
    if (type === "spotify") return "listening"
    if (type === "streaming") return "watching"
    if (type === "online") return "online"
    if (type === "offline") return "offline"
    if (type === "idle") return "idle"
    if (type === "dnd") return "dnd"

    // camera/screenshare log as type "voice" while live, check metadata
    if (type === "voice" || type === "vc_join" || type === "vc_leave") {
        const action = (meta.action || "").toLowerCase()
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        return "voice"
    }

    // activity/session are generic — real kind lives in metadata
    if (type === "activity" || type === "session") {
        const action = (meta.action || "").toLowerCase()
        const activityType = meta.type

        if (action === "status_session") return "status"
        if (action.includes("listening") || activityType === 2 || meta.trackId) return "listening"
        if (action.includes("voice")) return "voice"
        if (action.includes("camera")) return "camera"
        if (action.includes("stream") || action.includes("screen")) return "screen"
        if (action.includes("game") || activityType === 0) return "playing"
        if (activityType === 1) return "watching"

        return "session"
    }

    if (type === "status") return "status"

    return "session"
}

export const ACTIVITY_CATEGORIES = [
    { key: "msg" as ActivityType, label: "Messages", Icon: ico.catMsg, color: "#5865f2" },
    { key: "edit" as ActivityType, label: "Edits", Icon: ico.catEdit, color: "#f0b232" },
    { key: "delete" as ActivityType, label: "Deletes", Icon: ico.catDelete, color: "#da373c" },
    { key: "typing" as ActivityType, label: "Typing", Icon: ico.catTyping, color: "#949cf4" },
    { key: "status" as ActivityType, label: "Status", Icon: ico.catStatus, color: "#23a55a" },
    { key: "voice" as ActivityType, label: "Voice", Icon: ico.catVoice, color: "#dbdee1" },
    { key: "profile" as ActivityType, label: "Profile", Icon: ico.catProfile, color: "#ff6b6b" },
    { key: "activity" as ActivityType, label: "Activity", Icon: ico.catActivity, color: "#f0b232" },
] as const

export function matchesCategory(log: ActivityEntry, category: ActivityType): boolean {
    if (category === "msg") return log.type === "msg"
    if (category === "edit") return log.type === "edit"
    if (category === "delete") return log.type === "delete"
    if (category === "typing") return log.type === "typing"
    if (category === "status") {
        return log.type === "online" || log.type === "offline" || log.type === "idle" || log.type === "dnd" || log.type === "status" || log.type === "custom_status" || (log.type === "session" && log.metadata?.action === "status_session")
    }
    if (category === "voice") return log.type === "voice" || log.type === "vc_join" || log.type === "vc_leave" || log.type === "vc_move" || (log.type === "session" && (["voice_session", "stream_session", "camera_session"].includes(log.metadata?.action || "") || (log.metadata?.action || "").includes("voice")))
    if (category === "profile") return log.type === "profile" || log.type === "avatar" || log.type === "banner" || log.type === "bio" || log.type === "username" || log.type === "displayname" || log.type === "pronouns"
    if (category === "activity") return log.type === "activity" || log.type === "game_start" || log.type === "game_stop" || log.type === "spotify" || log.type === "streaming" || (log.type === "session" && (log.metadata?.action || "").includes("activity"))
    return log.type === category
}

export function ActivityCardIcon({ log }: { log: ActivityEntry }) {
    const [failed, setFailed] = React.useState(false)
    const isListening = log.metadata?.type === 2 || (log.metadata?.action || "").includes("listening")
    const appLogo = isListening ? MUSIC_APP_ICONS[(log.metadata?.appName || "").toLowerCase()] : ""
    const storedUrl = log.metadata?.iconUrl || log.metadata?.gameIconUrl || (isListening ? "" : log.metadata?.albumArtUrl) || ""
    const appId = log.metadata?.applicationId || ""
    // heals old entries logged before appIconCache existed
    const [healedUrl, setHealedUrl] = React.useState(() => (appId ? appIconCache[appId] || "" : ""))
    React.useEffect(() => {
        if (storedUrl || !appId || healedUrl || appIconCache[appId] !== undefined) return
        let live = true
        fetchAppIcon(appId).then(url => { if (live && url) setHealedUrl(url) }).catch(() => {})
        return () => { live = false }
    }, [storedUrl, appId, healedUrl])
    const realUrl = appLogo || storedUrl || healedUrl
    const key = getActivityIconKey(log)
    const { Icon, color } = actIco[key]
    const showImg = realUrl && !failed
    return (
        <div data-ur-card-icon className="ur-log-icon" style={{
            width: 42, height: 42, borderRadius: appLogo ? "50%" : 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, marginTop: 1, overflow: "hidden",
            background: showImg ? C.bg1 : `${color}1c`,
            border: appLogo ? "none" : `1px solid ${showImg ? C.border : color + "40"}`,
            color,
        }}>
            {showImg
                ? <img src={realUrl} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: appLogo ? "contain" : "cover", padding: appLogo ? 4 : 0 }} />
                : <Icon />}
        </div>
    )
}

// on-avatar status badges — built from the provided status SVG set instead of flat
// color dots. online/dnd/offline are complete self-contained badge shapes already;
// idle's source asset is just the crescent glyph with no backing circle, so it gets
// composited onto a solid circle here (crescent recolored to the card bg to "bite" it)
// to read as a full badge like the other three, matching Discord's real idle icon.
export function StatusBadgeIcon({ status }: { status: string }) {
    if (status === "online") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path d="M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8Z" fill="#45a366" />
            </svg>
        )
    }
    if (status === "dnd") {
        return (
            <svg viewBox="0 0 16 16" width="100%" height="100%">
                <path fillRule="evenodd" clipRule="evenodd" d="M8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16ZM5.24902 7C4.69674 7 4.24902 7.44772 4.24902 8C4.24902 8.55229 4.69674 9 5.24902 9H10.7499C11.3022 9 11.7499 8.55229 11.7499 8C11.7499 7.44772 11.3022 7 10.7499 7H5.24902Z" fill="#e00000" />
            </svg>
        )
    }
    if (status === "idle") {
        return (
            <svg viewBox="0 0 24 24" width="100%" height="100%" style={{ transform: "scaleX(-1)" }}>
                <path d="M12.0557 3.59974C12.2752 3.2813 12.2913 2.86484 12.0972 2.53033C11.9031 2.19582 11.5335 2.00324 11.1481 2.03579C6.02351 2.46868 2 6.76392 2 12C2 17.5228 6.47715 22 12 22C17.236 22 21.5313 17.9764 21.9642 12.8518C21.9967 12.4664 21.8041 12.0968 21.4696 11.9027C21.1351 11.7086 20.7187 11.7248 20.4002 11.9443C19.4341 12.6102 18.2641 13 17 13C13.6863 13 11 10.3137 11 6.99996C11 5.73589 11.3898 4.56587 12.0557 3.59974Z" fill="#ffc04e" />
            </svg>
        )
    }
    // offline / invisible — hollow ring, same as Discord's real offline badge
    return (
        <svg viewBox="0 0 16 16" width="100%" height="100%">
            <path fillRule="evenodd" clipRule="evenodd" d="M8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2ZM0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8Z" fill="#84858d" />
        </svg>
    )
}

type LogCardProps = {
    log: ActivityEntry
    expanded: boolean
    onToggle: (id: string) => void
    onDelete: (id: string) => void
    userId: string
}

function LogCardInner({ log, expanded, onToggle, onDelete, userId }: LogCardProps) {
    return (
            <div
                key={log.id}
                data-ur-card-body
                className={`ur-log-card${expanded ? " open" : ""}`}
                onClick={() => onToggle(log.id)}
                style={{
                    display: "flex",
                    gap: 14,
                    padding: "14px 16px",
                    borderRadius: 18,
                    background: expanded
                        ? "linear-gradient(135deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.03) 100%)"
                        : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                    border: `1px solid ${expanded ? C.bgEl : C.border}`,
                    marginBottom: 6,
                    cursor: "pointer",
                    minHeight: 56,
                }}
            >
                <ActivityCardIcon log={log} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    {(() => {
                        // Check if this log entry has an ongoing active session
                        const isLiveSession = Object.values(activeSessions).some(s => s.logId === log.id)
                        return isLiveSession ? (
                            <div data-ur-card-live style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 10,
                                fontWeight: 800,
                                textTransform: "uppercase",
                                letterSpacing: 0.6,
                                color: "#23a55a",
                                background: "rgba(35,165,90,0.12)",
                                border: "1px solid rgba(35,165,90,0.3)",
                                borderRadius: 8,
                                padding: "3px 8px",
                                marginBottom: 5,
                            }}>
                                <span className="ur-blink-dot" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#23a55a", flexShrink: 0 }} />
                                Live
                            </div>
                        ) : null
                    })()}
                    <div data-ur-card-title style={{
                        fontSize: log.type === "msg" || log.type === "edit" || log.type === "delete" ? 15 : 14,
                        fontWeight: 800,
                        color: C.header,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                    }}>
                        <span style={{ wordBreak: "break-word", flex: 1, minWidth: 0 }}>
                            {(() => {
                                // still in vc — show "In #channel" not "joined"
                                const isLive = Object.values(activeSessions).some(s => s.logId === log.id)
                                if (isLive && log.type === "voice" && log.metadata?.action === "joined") {
                                    return `In #${log.metadata.channel || "voice"}`
                                }
                                return log.title
                            })()}
                        </span>
                        <span style={{
                            fontSize: 12,
                            color: C.subheader,
                            fontWeight: 700,
                            background: C.bg1,
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: `1px solid ${C.border}`,
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }} title={exactTime(log.ts)}>
                            <span style={{ display: "flex", alignItems: "center" }}><ico.clock /></span>
                            {new Date(log.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                            <span style={{ color: C.muted, fontWeight: 500 }}>· {timeAgo(log.ts)}</span>
                        </span>
                        <div className={`ur-log-chevron${expanded ? " open" : ""}`} title={expanded ? "Collapse" : "Expand"}>
                            <ico.chevron />
                        </div>
                        <div
                            role="button"
                            title="Delete this entry"
                            onClick={async (e) => {
                                e.stopPropagation()
                                if (!confirm("Delete this activity entry?")) return
                                await activityStore.removeLog(userId, log.id)
                                onDelete(log.id)
                            }}
                            style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                cursor: "pointer",
                                background: "transparent",
                                color: C.muted,
                                fontSize: 11,
                                fontWeight: 700,
                                display: "flex",
                                alignItems: "center",
                                opacity: 0.4,
                                transition: "opacity 150ms ease, background 150ms ease, color 150ms ease",
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.opacity = "1"
                                e.currentTarget.style.background = "rgba(218,55,60,0.12)"
                                e.currentTarget.style.color = C.red
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.opacity = "0.4"
                                e.currentTarget.style.background = "transparent"
                                e.currentTarget.style.color = C.muted
                            }}
                        >
                            <ico.trash />
                        </div>
                    </div>
                    {log.body && log.body !== log.title && log.type !== "activity" && log.type !== "session" && log.type !== "edit" && log.metadata?.action !== "status_session" && (
                        <div data-ur-card-body-text={(log.type === "msg" || log.type === "delete") ? "content" : "meta"} style={{
                            fontSize: log.type === "msg" || log.type === "delete" ? 14 : 13,
                            color: log.type === "msg" || log.type === "delete" ? C.text : C.muted,
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                            fontWeight: log.type === "msg" || log.type === "delete" ? 500 : 400,
                            marginTop: log.type === "msg" || log.type === "delete" ? 2 : 0,
                        }}>
                            {log.body}
                        </div>
                    )}
                    {(log.type === "msg" || log.type === "edit" || log.type === "delete" || log.type === "voice" || log.type === "activity" || (log.type === "session" && ["listening_session", "activity_session", "voice_session", "camera_session", "stream_session"].includes(log.metadata?.action))) && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.location /></span>
                            <span>
                                {(log.type === "activity" || log.type === "session") && log.metadata?.appName
                                    ? log.metadata.appName
                                    : log.metadata?.server || "Unknown"}
                                {log.metadata?.channel ? ` · #${log.metadata.channel}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "session" && log.metadata?.action === "status_session" && (
                        <div data-ur-card-location style={{
                            fontSize: 11,
                            color: C.subheader,
                            marginTop: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                        }}>
                            <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}><ico.status /></span>
                            <span>
                                {log.metadata?.platform ? `${CLIENT_EMOJI[log.metadata.platform.toLowerCase()] || "📡"} ${log.metadata.platform}` : "Status session"}
                                {log.metadata?.duration ? ` · ${log.metadata.duration}` : ""}
                            </span>
                        </div>
                    )}
                    {log.type === "edit" && log.metadata?.before && (
                        <div style={{
                            marginTop: 10,
                            borderRadius: 14,
                            overflow: "hidden",
                            border: `1px solid rgba(240,178,50,0.25)`,
                        }}>
                            <div style={{ padding: "8px 14px", background: "rgba(240,178,50,0.08)", fontSize: 10, fontWeight: 800, color: "#f0b232", textTransform: "uppercase", letterSpacing: 0.6, display: "flex", alignItems: "center", gap: 6 }}>
                                <ico.edit />
                                Message Edit
                            </div>
                            <div style={{ padding: "10px 14px", borderBottom: log.metadata?.after ? `1px solid rgba(240,178,50,0.15)` : "none", background: "rgba(218,55,60,0.06)" }}>
                                <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>Before</div>
                                <span style={{ fontSize: 12, textDecoration: "line-through", opacity: 0.7, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                    {trunc(log.metadata.before, 300)}
                                </span>
                            </div>
                            {log.metadata?.after && (
                                <div style={{ padding: "10px 14px", background: "rgba(36,128,70,0.06)" }}>
                                    <div style={{ fontSize: 9, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>After</div>
                                    <span style={{ fontSize: 12, wordBreak: "break-word", lineHeight: 1.5, color: C.text }}>
                                        {trunc(log.metadata.after, 300)}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    <div className={`ur-expand${expanded ? " open" : ""}`}>
                        <div className={expanded ? "ur-log-expand-in" : ""}>
                            {(log.channelId || log.guildId) && (
                                <div
                                    onClick={(e) => { e.stopPropagation(); jumpTo(log.guildId, log.channelId, log.msgId) }}
                                    style={{
                                        marginTop: 10,
                                        padding: "10px 16px",
                                        background: C.brand,
                                        borderRadius: 10,
                                        color: C.white,
                                        fontSize: 13,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        textAlign: "center",
                                        fontFamily: "inherit",
                                        transition: "background 150ms ease",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 6,
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = "#4752c4" }}
                                    onMouseLeave={e => { e.currentTarget.style.background = C.brand }}
                                >
                                    <ico.external />
                                    Jump to Discord
                                </div>
                            )}
                            {/* Profile field before/after diff card */}
                            {(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && log.metadata && (log.metadata.before !== undefined || log.metadata.after !== undefined || log.metadata.oldAvatar !== undefined || log.metadata.newAvatar !== undefined) && (
                                <div style={{
                                    marginTop: 10,
                                    borderRadius: 14,
                                    overflow: "hidden",
                                    border: `1px solid rgba(255,107,107,0.3)`,
                                }}>
                                    {/* Header */}
                                    <div style={{
                                        padding: "8px 14px",
                                        background: "rgba(255,107,107,0.12)",
                                        fontSize: 10,
                                        fontWeight: 800,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.6,
                                        color: "#ff6b6b",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                    }}>
                                        <span style={{ display: "flex", alignItems: "center", transform: "scale(0.7)" }}>
                                            {(() => {
                                                const key = getActivityIconKey(log)
                                                const { Icon } = actIco[key]
                                                return <Icon />
                                            })()}
                                        </span>
                                        <span>{FIELD_NAME[log.metadata.field ?? ""] ?? log.type.replace("_", " ")} change</span>
                                    </div>
                                    {/* Avatar images row */}
                                    {log.type === "avatar" && (log.metadata.oldAvatar || log.metadata.newAvatar) && (
                                        <div style={{
                                            display: "flex",
                                            gap: 12,
                                            padding: "14px",
                                            background: C.bg1,
                                            alignItems: "center",
                                        }}>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Before</div>
                                                {log.metadata.oldAvatar
                                                    ? <img src={log.metadata.oldAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid ${C.border}` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                            <div style={{ fontSize: 20, color: C.muted, flexShrink: 0 }}>→</div>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>After</div>
                                                {log.metadata.newAvatar
                                                    ? <img src={log.metadata.newAvatar} style={{ width: 64, height: 64, borderRadius: "50%", border: `2px solid rgba(255,107,107,0.5)` }} onError={(e: any) => { e.target.style.display = "none" }} />
                                                    : <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.bg2, border: `2px solid rgba(255,107,107,0.5)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚫</div>
                                                }
                                            </div>
                                        </div>
                                    )}
                                    {/* Text before/after */}
                                    {log.type !== "avatar" && (
                                        <div style={{ background: C.bg1 }}>
                                            {log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}` }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>Before</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(218,55,60,0.08)",
                                                        border: "1px solid rgba(218,55,60,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                        textDecoration: "line-through",
                                                        opacity: 0.8,
                                                    }}>
                                                        {String(log.metadata.before)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.text,
                                                        background: "rgba(36,128,70,0.08)",
                                                        border: "1px solid rgba(36,128,70,0.25)",
                                                        borderRadius: 8,
                                                        padding: "8px 10px",
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        lineHeight: 1.5,
                                                    }}>
                                                        {String(log.metadata.after)}
                                                    </div>
                                                </div>
                                            )}
                                            {log.metadata.after == null && log.metadata.before != null && (
                                                <div style={{ padding: "10px 14px" }}>
                                                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, marginBottom: 5 }}>After</div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        fontStyle: "italic",
                                                        padding: "8px 10px",
                                                    }}>
                                                        (removed)
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            {log.metadata && log.type !== "msg" && log.type !== "edit" && log.type !== "delete" && !(["username","displayname","bio","banner","pronouns","custom_status","avatar"] as ActivityType[]).includes(log.type) && (
                                <div style={{
                                    marginTop: 10,
                                    padding: "12px 16px",
                                    background: C.bg1,
                                    borderRadius: 12,
                                    fontSize: 12,
                                    color: C.muted,
                                    lineHeight: 1.6,
                                    border: `1px solid ${C.border}`,
                                }}>
                                    {log.metadata.song && (
                                        <div
                                            ref={(el: any) => {
                                                if (!el || !log.metadata?.albumArtUrl) return
                                                const cached = _albumColorCache[log.metadata.albumArtUrl]
                                                if (cached) {
                                                    el.style.background = hexToRgba(cached, 0.06)
                                                    el.style.borderColor = hexToRgba(cached, 0.35)
                                                    return
                                                }
                                                extractAlbumColor(log.metadata!.albumArtUrl!).then((hex: string) => {
                                                    if (el) {
                                                        el.style.background = hexToRgba(hex, 0.06)
                                                        el.style.borderColor = hexToRgba(hex, 0.35)
                                                    }
                                                })
                                            }}
                                            style={{
                                                display: "flex",
                                                gap: 0,
                                                marginBottom: 12,
                                                borderRadius: 10,
                                                border: "1px solid rgba(30,215,96,0.2)",
                                                overflow: "hidden",
                                                background: "rgba(30,215,96,0.06)",
                                                transition: "background 300ms ease, border-color 300ms ease",
                                                position: "relative",
                                                minHeight: 160,
                                            }}
                                        >
                                            {log.metadata.albumArtUrl && (
                                                <div style={{
                                                    position: "relative",
                                                    width: 160,
                                                    height: 160,
                                                    overflow: "hidden",
                                                    borderRadius: 10,
                                                    flexShrink: 0,
                                                    alignSelf: "center",
                                                }}>
                                                    <img
                                                        src={log.metadata.albumArtUrl}
                                                        style={{
                                                            position: "absolute",
                                                            top: 0,
                                                            left: 0,
                                                            width: "100%",
                                                            height: "100%",
                                                            objectFit: "cover",
                                                            display: "block",
                                                            borderRadius: 8,
                                                        }}
                                                        onError={(e: any) => { e.target.style.display = "none" }}
                                                    />
                                                    <div style={{
                                                        position: "absolute",
                                                        top: 0,
                                                        right: 0,
                                                        width: 50,
                                                        height: "100%",
                                                        background: "linear-gradient(to right, transparent, rgba(0,0,0,0.4))",
                                                        pointerEvents: "none",
                                                    }} />
                                                </div>
                                            )}
                                            <div style={{
                                                flex: 1,
                                                minWidth: 0,
                                                display: "flex",
                                                flexDirection: "column",
                                                justifyContent: "center",
                                                padding: "14px 16px",
                                                gap: 1,
                                            }}>
                                                {log.metadata.appName && (
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.8,
                                                        color: C.brandLight,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 5,
                                                        marginBottom: 4,
                                                    }}>
                                                        {log.metadata.appName === "Spotify" && <span>🎵</span>}
                                                        {log.metadata.appName}
                                                    </div>
                                                )}
                                                <div style={{
                                                    fontSize: 16,
                                                    fontWeight: 800,
                                                    color: C.header,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    lineHeight: 1.2,
                                                    letterSpacing: -0.2,
                                                }}>
                                                    {log.metadata.song}
                                                </div>
                                                {log.metadata.artist && (
                                                    <div style={{
                                                        fontSize: 14,
                                                        color: C.text,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        fontWeight: 500,
                                                        marginTop: 2,
                                                    }}>
                                                        {log.metadata.artist}
                                                    </div>
                                                )}
                                                {log.metadata.album && (
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: C.muted,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        marginTop: 1,
                                                    }}>
                                                        {log.metadata.album}
                                                    </div>
                                                )}
                                                <div style={{
                                                    display: "flex",
                                                    gap: 6,
                                                    marginTop: 8,
                                                    flexWrap: "wrap",
                                                    alignItems: "center",
                                                }}>
                                                    {Array.isArray(log.metadata.allArtists) && log.metadata.allArtists.length > 1 && (
                                                        <span style={{
                                                            fontSize: 10,
                                                            color: C.muted,
                                                            background: "rgba(0,0,0,0.25)",
                                                            padding: "2px 8px",
                                                            borderRadius: 10,
                                                            fontWeight: 600,
                                                        }} title={`All artists: ${log.metadata.allArtists.join(", ")}`}>
                                                            +{log.metadata.allArtists.length - 1} more
                                                        </span>
                                                    )}
                                                    {log.metadata.contextUri && (
                                                        <span style={{
                                                            fontSize: 10,
                                                            color: C.muted,
                                                            background: "rgba(0,0,0,0.25)",
                                                            padding: "2px 8px",
                                                            borderRadius: 10,
                                                            fontWeight: 600,
                                                        }} title={log.metadata.contextUri}>
                                                            {log.metadata.contextUri.includes("playlist") ? "🎶 Playlist" : log.metadata.contextUri.includes("album") ? "💿 Album" : "🎵 Context"}
                                                        </span>
                                                    )}
                                                </div>
                                                {(() => {
                                                    // discord's own endTimestamp is optional and rarely sent outside spotify —
                                                    // fall back to the plugin's own captured start/end wall-clock times
                                                    const hasDiscordRange = log.metadata.startTimestamp && log.metadata.endTimestamp
                                                    const startTs = hasDiscordRange ? log.metadata.startTimestamp : log.metadata.startTime
                                                    const endTs = hasDiscordRange ? log.metadata.endTimestamp : (log.metadata.endTime || Date.now())
                                                    if (!startTs) return null

                                                    const total = endTs - startTs
                                                    const totalStr = formatDuration(total)
                                                    // full bar if ended, live calc if still going
                                                    const isSession = log.type === "session"
                                                    const elapsed = isSession && log.metadata.endTime
                                                        ? log.metadata.endTime - startTs
                                                        : Date.now() - startTs
                                                    const progress = Math.min(100, Math.max(0, (elapsed / total) * 100))
                                                    const currentStr = formatDuration(Math.min(elapsed, total))
                                                    return (
                                                        <div style={{ marginTop: 12 }}>
                                                            <div style={{
                                                                height: 4,
                                                                background: "rgba(0,0,0,0.3)",
                                                                borderRadius: 2,
                                                                overflow: "hidden",
                                                            }}>
                                                                <div style={{
                                                                    width: `${progress}%`,
                                                                    height: "100%",
                                                                    background: C.brandLight,
                                                                    borderRadius: 2,
                                                                    transition: "width 0.3s ease",
                                                                }} />
                                                            </div>
                                                            <div style={{
                                                                display: "flex",
                                                                justifyContent: "space-between",
                                                                marginTop: 5,
                                                                fontSize: 11,
                                                                color: C.muted,
                                                                fontWeight: 600,
                                                                letterSpacing: 0.3,
                                                            }}>
                                                                <span>{currentStr}</span>
                                                                <span>{totalStr}</span>
                                                            </div>
                                                        </div>
                                                    )
                                                })()}
                                            </div>
                                        </div>
                                    )}
                                    {log.metadata.gameIconUrl && !log.metadata.song && (
                                        <div style={{
                                            display: "flex",
                                            gap: 12,
                                            marginBottom: 12,
                                            padding: "10px 12px",
                                            background: "rgba(88,101,242,0.08)",
                                            borderRadius: 10,
                                            border: "1px solid rgba(88,101,242,0.2)",
                                        }}>
                                            <img
                                                src={log.metadata.gameIconUrl}
                                                style={{
                                                    width: 56, height: 56,
                                                    borderRadius: 12,
                                                    objectFit: "cover",
                                                    flexShrink: 0,
                                                    border: `1px solid ${C.border}`,
                                                }}
                                                onError={(e: any) => { e.target.style.display = "none" }}
                                            />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                {log.metadata.appName && (
                                                    <div style={{
                                                        fontSize: 9,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.6,
                                                        color: C.brandLight,
                                                        marginBottom: 3,
                                                    }}>
                                                        {log.metadata.appName}
                                                    </div>
                                                )}
                                                {log.metadata.details && (
                                                    <div style={{
                                                        fontSize: 13,
                                                        fontWeight: 800,
                                                        color: C.header,
                                                        marginBottom: 2,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}>
                                                        {log.metadata.details}
                                                    </div>
                                                )}
                                                {log.metadata.state && (
                                                    <div style={{
                                                        fontSize: 11,
                                                        color: C.muted,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                    }}>
                                                        {log.metadata.state}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {log.metadata.duration && log.metadata.action !== "listening_session" && (
                                        <div style={{
                                            marginBottom: 10,
                                            padding: "10px 14px",
                                            background: C.bg1,
                                            borderRadius: 10,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <div style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 8,
                                                marginBottom: 8,
                                            }}>
                                                <span style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    color: C.brandLight,
                                                }}><ico.clock /></span>
                                                <span style={{ color: C.brandLight, fontWeight: 800, fontSize: 13 }}>
                                                    {log.metadata.duration}
                                                </span>
                                            </div>

                                            {log.metadata.startTime && (
                                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                        <div style={{
                                                            width: 8, height: 8, borderRadius: "50%",
                                                            background: C.green,
                                                            flexShrink: 0,
                                                            boxShadow: `0 0 0 3px ${C.green}30`,
                                                        }} />
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                                                                {log.metadata.action === "status_session" ? "Online" :
                                                                 log.metadata.action === "activity_session" || log.metadata.action === "listening_session" ? "Started" : "Joined"}
                                                            </div>
                                                            <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                                                                {new Date(log.metadata.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                                                                <span style={{ color: C.muted, fontWeight: 500, marginLeft: 6 }}>
                                                                    {new Date(log.metadata.startTime).toLocaleDateString([], { month: "short", day: "numeric" })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 3 }}>
                                                        <div style={{ width: 2, height: 20, background: `linear-gradient(to bottom, ${C.green}, ${C.red})`, borderRadius: 1 }} />
                                                        <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>
                                                            {log.metadata.duration}
                                                        </div>
                                                    </div>

                                                    {log.metadata.endTime && (
                                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                            <div style={{
                                                                width: 8, height: 8, borderRadius: "50%",
                                                                background: C.red,
                                                                flexShrink: 0,
                                                                boxShadow: `0 0 0 3px ${C.red}30`,
                                                            }} />
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                                                                    {log.metadata.action === "status_session" ? "Offline" :
                                                                     log.metadata.action === "activity_session" || log.metadata.action === "listening_session" ? "Stopped" : "Left"}
                                                                </div>
                                                                <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                                                                    {new Date(log.metadata.endTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                                                                    <span style={{ color: C.muted, fontWeight: 500, marginLeft: 6 }}>
                                                                        {new Date(log.metadata.endTime).toLocaleDateString([], { month: "short", day: "numeric" })}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {!log.metadata.endTime && (
                                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                            <div style={{
                                                                width: 8, height: 8, borderRadius: "50%",
                                                                background: C.brand,
                                                                flexShrink: 0,
                                                                animation: "ur-pulse 2s infinite",
                                                            }} />
                                                            <div style={{ fontSize: 12, color: C.brandLight, fontWeight: 700 }}>
                                                                Still active…
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {log.metadata.action === "status_session" && Array.isArray(log.metadata.statusTimeline) && log.metadata.statusTimeline.length > 0 && (
                                        <div style={{
                                            marginBottom: 10,
                                            padding: "12px 14px",
                                            background: C.bg1,
                                            borderRadius: 10,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <div style={{
                                                fontSize: 10,
                                                fontWeight: 800,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.8,
                                                color: C.subheader,
                                                marginBottom: 10,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                            }}>
                                                <span style={{ display: "flex", alignItems: "center" }}><ico.status /></span>
                                                Status Timeline
                                            </div>
                                            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                                {log.metadata.statusTimeline.map((ch: any, i: number) => (
                                                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                                                        <div style={{
                                                            width: 10, height: 10, borderRadius: "50%",
                                                            background: ch.status === "online" ? "#23a55a" : ch.status === "idle" ? "#f0b232" : ch.status === "dnd" ? "#da373c" : "#80848e",
                                                            flexShrink: 0,
                                                            boxShadow: `0 0 0 3px ${ch.status === "online" ? "#23a55a30" : ch.status === "idle" ? "#f0b23230" : ch.status === "dnd" ? "#da373c30" : "#80848e30"}`,
                                                        }} />
                                                        {i < log.metadata!.statusTimeline.length - 1 && (
                                                            <div style={{
                                                                position: "absolute",
                                                                left: 4,
                                                                top: 14,
                                                                width: 2,
                                                                height: 24,
                                                                background: C.border,
                                                                borderRadius: 1,
                                                            }} />
                                                        )}
                                                        <div style={{ flex: 1, minWidth: 0, paddingBottom: i < log.metadata!.statusTimeline.length - 1 ? 8 : 0 }}>
                                                            <div style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: 6,
                                                                flexWrap: "wrap",
                                                            }}>
                                                                <span style={{
                                                                    fontSize: 12,
                                                                    fontWeight: 700,
                                                                    color: C.header,
                                                                }}>
                                                                    {ch.emoji} {ch.label}
                                                                </span>
                                                                <span style={{
                                                                    fontSize: 10,
                                                                    color: C.muted,
                                                                    fontFamily: "monospace",
                                                                    marginLeft: "auto",
                                                                }}>
                                                                    {ch.time}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {Array.isArray(log.metadata.platformTimeline) && log.metadata.platformTimeline.length > 0 && (
                                                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        textTransform: "uppercase",
                                                        letterSpacing: 0.8,
                                                        color: C.subheader,
                                                        marginBottom: 8,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                    }}>
                                                        <span style={{ display: "flex", alignItems: "center" }}><ico.activity /></span>
                                                        Platform Changes
                                                    </div>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                                        {log.metadata.platformTimeline.map((pt: any, i: number) => (
                                                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
                                                                <div style={{
                                                                    width: 10, height: 10, borderRadius: "50%",
                                                                    background: C.brandLight,
                                                                    flexShrink: 0,
                                                                    boxShadow: `0 0 0 3px ${C.brandLight}30`,
                                                                }} />
                                                                {i < log.metadata!.platformTimeline.length - 1 && (
                                                                    <div style={{
                                                                        position: "absolute",
                                                                        left: 4,
                                                                        top: 14,
                                                                        width: 2,
                                                                        height: 24,
                                                                        background: C.border,
                                                                        borderRadius: 1,
                                                                    }} />
                                                                )}
                                                                <div style={{ flex: 1, minWidth: 0, paddingBottom: i < log.metadata!.platformTimeline.length - 1 ? 8 : 0 }}>
                                                                    <div style={{
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                        flexWrap: "wrap",
                                                                    }}>
                                                                        <span style={{
                                                                            fontSize: 12,
                                                                            fontWeight: 700,
                                                                            color: C.header,
                                                                        }}>
                                                                            {CLIENT_EMOJI[pt.platform.toLowerCase()] || "📡"} {CLIENT_LABEL_MAP[pt.platform] || pt.platform}
                                                                        </span>
                                                                        <span style={{
                                                                            fontSize: 10,
                                                                            color: C.muted,
                                                                            fontFamily: "monospace",
                                                                            marginLeft: "auto",
                                                                        }}>
                                                                            {pt.time}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div style={{
                                                marginTop: 10,
                                                paddingTop: 8,
                                                borderTop: `1px solid ${C.border}`,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                            }}>
                                                <span style={{ fontSize: 10, color: C.muted }}>
                                                    Started {new Date(log.metadata.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                                                </span>
                                                <span style={{
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    color: C.brandLight,
                                                    background: "rgba(88,101,242,0.1)",
                                                    padding: "2px 8px",
                                                    borderRadius: 6,
                                                }}>
                                                    {log.metadata.duration}
                                                </span>
                                            </div>
                                        </div>
                                    )}

                                    {log.metadata.platform && (
                                        <div style={{
                                            display: "flex",
                                            gap: 10,
                                            marginBottom: 8,
                                            alignItems: "center",
                                            padding: "6px 10px",
                                            background: C.bg2,
                                            borderRadius: 8,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <span style={{ color: C.brandLight, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Platform</span>
                                            <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>
                                                {CLIENT_EMOJI[log.metadata.platformKey || String(log.metadata.platform).toLowerCase()] || "📡"} {CLIENT_LABEL_MAP[log.metadata.platform] || log.metadata.platform}
                                            </span>
                                        </div>
                                    )}
                                    {Object.entries(log.metadata)
                                        .filter(([key, val]) =>
                                            !["duration","startTime","endTime","members","metadata","type","action","name","song","artist","allArtists","album","trackId","albumId","artistIds","contextUri","trackType","albumArtUrl","largeImage","smallImage","smallText","statusDisplayType","createdAt","sessionId","partyId","partySize","appName","appLogo","gameIconUrl","applicationId","parentApplicationId","platform","platformKey","flags","buttons","secrets","url","startTimestamp","endTimestamp","timestamps","party","assets","statusTimeline","platformTimeline","startStatus","endStatus","changeCount","before","after","field","oldAvatar","newAvatar"].includes(key) &&
                                            val !== undefined && val !== null && val !== "" &&
                                            !(typeof val === "object" && Object.keys(val).length === 0)
                                        )
                                        .map(([key, val]) => (
                                        <div key={key} style={{
                                            display: "flex",
                                            gap: 10,
                                            marginBottom: 6,
                                            alignItems: "center",
                                            padding: "6px 10px",
                                            background: C.bg2,
                                            borderRadius: 8,
                                            border: `1px solid ${C.border}`,
                                        }}>
                                            <span style={{
                                                color: C.brandLight,
                                                minWidth: 80,
                                                fontWeight: 700,
                                                fontSize: 11,
                                                textTransform: "uppercase",
                                                letterSpacing: 0.5
                                            }}>{key}</span>
                                            <span style={{
                                                color: C.text,
                                                wordBreak: "break-word",
                                                flex: 1,
                                                fontSize: 12,
                                                fontWeight: 600,
                                            }}>
                                                {typeof val === "object" ? JSON.stringify(val) : String(val)}
                                            </span>
                                        </div>
                                    ))}
                                    {Array.isArray(log.metadata.members) && log.metadata.members.length > 0 && (
                                        <div style={{ display: "flex", gap: 10, marginBottom: 4, alignItems: "baseline" }}>
                                            <span style={{ color: C.brandLight, minWidth: 80, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>WITH</span>
                                            <span style={{ color: C.text, flex: 1, wordBreak: "break-word" }}>{(log.metadata.members as string[]).join(", ")}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
    )
}

// memo so a new event or a filter change doesn't re-render every card.
// React.memo can't run while the plugin file loads (webpack isn't ready yet),
// so it is created on the first render instead
let MemoCard: ((props: LogCardProps) => JSX.Element) | null = null
export function LogCard(props: LogCardProps) {
    MemoCard ??= React.memo(LogCardInner) as unknown as (props: LogCardProps) => JSX.Element
    return <MemoCard {...props} />
}
