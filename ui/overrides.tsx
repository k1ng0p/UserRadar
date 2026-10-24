import type { JSX } from "react"

import { ico } from "./icons"

export const OV_GROUPS = {
    messages: [
        { label: "messages",  key: "msgs",     gk: "globalMsgs",     Icon: ico.msg,      desc: "Notify on new messages" },
        { label: "edits",     key: "edits",    gk: "globalEdits",    Icon: ico.edit,     desc: "Notify on message edits" },
        { label: "deletes",   key: "deletes",  gk: "globalDeletes",  Icon: ico.del,      desc: "Notify on deleted messages" },
        { label: "typing",    key: "typing",   gk: "globalTyping",   Icon: ico.typing,   desc: "Notify when typing starts" },
    ],
    presence: [
        { label: "status",    key: "status",   gk: "globalStatus",   Icon: ico.status,   desc: "Notify on status changes" },
        { label: "activity",  key: "activity", gk: "globalActivity", Icon: ico.activity, desc: "Game/music activity (off by default)" },
        { label: "voice",     key: "voice",    gk: "globalVoice",    Icon: ico.voice,    desc: "Notify on voice channel activity" },
        { label: "joins",     key: "joins",    gk: "globalJoins",    Icon: ico.joins,    desc: "Notify on server joins / leaves" },
    ],
    profile: [
        { label: "profile",   key: "profile",  gk: "globalProfile",  Icon: ico.profile,  desc: "Notify on profile changes" },
        { label: "avatar",    key: "avatar",   gk: "globalAvatar",   Icon: ico.avatar,   desc: "Notify on avatar updates" },
    ],
} as const

export type OvTab = "messages" | "presence" | "profile"

export const OV_TAB_LABELS: Record<OvTab, string> = { messages: "Messages", presence: "Presence", profile: "Profile" }

export const OV_TAB_ICONS: Record<OvTab, () => JSX.Element> = {
    messages: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 22V4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 4z"/></svg>,
    presence: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" opacity=".25"/><circle cx="12" cy="12" r="5"/></svg>,
    profile:  () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
}
