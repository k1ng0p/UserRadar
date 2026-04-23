// WatchlistModal.tsx

import { React } from "@webpack/common"
import { Button, Text, TextInput } from "@webpack/common"
import { UserStore, RestAPI } from "@webpack/common"
import { ModalRoot, ModalHeader, ModalContent, ModalSize } from "@utils/modal"

import { WatchedUser } from "./types"
import {
    getWatchlist, addUser, removeUser,
    patchUser, isWatched, camelize,
    displayName, featureOn
} from "./store"

// only animations and structural layout — zero color rules
// colors are all inline so the UA stylesheet can never win
const STYLE_ID = "ur-s4"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement("style")
    el.id = STYLE_ID
    el.textContent = `
        @keyframes ur-in   { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes ur-spin { to { transform: rotate(360deg) } }

        .ur-card {
            border-radius: 10px;
            border: 1px solid var(--background-modifier-accent);
            background: var(--background-secondary);
            margin-bottom: 8px;
            overflow: hidden;
            transition: border-color 0.15s, box-shadow 0.15s;
            animation: ur-in 0.15s ease;
        }
        .ur-card:hover {
            border-color: rgba(88, 101, 242, 0.45);
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
        }
        .ur-toggle {
            position: relative;
            width: 32px; height: 18px;
            border-radius: 9px;
            flex-shrink: 0;
            cursor: pointer;
            transition: background 0.15s;
        }
        .ur-knob {
            position: absolute;
            top: 2px;
            width: 14px; height: 14px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            transition: left 0.15s;
        }
        .ur-spinner {
            display: inline-block;
            width: 12px; height: 12px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            animation: ur-spin 0.6s linear infinite;
            vertical-align: middle;
        }
    `
    document.head.appendChild(el)
}

// --- CDN helpers ---

function avatarUrl(id: string, hash?: string | null, size = 80) {
    if (hash) {
        const ext = hash.startsWith("a_") ? "gif" : "webp"
        return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=${size}`
    }
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % 6n)}.png`
}

function bannerUrl(id: string, hash?: string | null) {
    if (!hash) return null
    return `https://cdn.discordapp.com/banners/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=480`
}

function toHex(n?: number | null) {
    if (n == null) return null
    return "#" + n.toString(16).padStart(6, "0")
}

// --- toggle ---
// has to be custom since discord's Switch component isn't cleanly exported
// inline background so no class-color issues

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            className="ur-toggle"
            style={{ background: on ? "var(--brand-500)" : "var(--background-modifier-accent)" }}
            onClick={e => { e.stopPropagation(); onChange(!on) }}
        >
            <div className="ur-knob" style={{ left: on ? 16 : 2 }} />
        </div>
    )
}

// --- icon button ---
// "all: unset" nukes every browser/UA default before we set anything
// this is the only reliable way to stop buttons from having black text

function IconBtn({
    onClick, title, danger = false, children
}: {
    onClick: () => void
    title?: string
    danger?: boolean
    children: React.ReactNode
}) {
    const [hovered, setHovered] = React.useState(false)

    const color = danger && hovered
        ? "var(--status-danger)"
        : hovered
            ? "var(--interactive-hover)"
            : "var(--interactive-normal)"

    const bg = danger && hovered
        ? "rgba(237,66,69,0.1)"
        : hovered
            ? "var(--background-modifier-hover)"
            : "transparent"

    return (
        <button
            title={title}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                all: "unset",
                cursor: "pointer",
                color,
                background: bg,
                borderRadius: 6,
                padding: "5px 8px",
                fontSize: 15,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.12s, color 0.12s",
                boxSizing: "border-box",
            } as React.CSSProperties}
        >
            {children}
        </button>
    )
}

// --- tab button ---

function TabBtn({
    active, onClick, children
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    const [hovered, setHovered] = React.useState(false)

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                all: "unset",
                flex: 1,
                textAlign: "center",
                padding: "7px 0",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active
                    ? "var(--header-primary)"
                    : hovered
                        ? "var(--text-normal)"
                        : "var(--text-muted)",
                background: active
                    ? "var(--background-primary)"
                    : hovered
                        ? "var(--background-modifier-hover)"
                        : "transparent",
                boxShadow: active ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
                transition: "background 0.12s, color 0.12s",
                boxSizing: "border-box",
            } as React.CSSProperties}
        >
            {children}
        </button>
    )
}

// --- ADD TAB ---

type LookupState =
    | { stage: "idle" }
    | { stage: "loading" }
    | { stage: "found"; user: any; av: string; banner: string | null; accent: string | null }
    | { stage: "error"; msg: string }

function AddTab({ settings, onAdded }: { settings: any; onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupState>({ stage: "idle" })

    const cleanId = rawId.trim().replace(/\D/g, "")

    const doLookup = async () => {
        if (!cleanId)
            return setLk({ stage: "error", msg: "Paste a user ID first." })
        if (cleanId.length < 17 || cleanId.length > 20)
            return setLk({ stage: "error", msg: "Discord IDs are 17–20 digits — double-check that." })
        if (isWatched(settings, cleanId))
            return setLk({ stage: "error", msg: "Already watching this person." })

        setLk({ stage: "loading" })
        try {
            const { body } = await RestAPI.get({
                url: `/users/${cleanId}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            })
            const d = camelize(body)
            setLk({
                stage: "found",
                user: d.user,
                av: avatarUrl(d.user.id, d.user.avatar, 128),
                banner: bannerUrl(d.user.id, d.user.banner),
                accent: toHex(d.user.accentColor),
            })
        } catch (e: any) {
            const s = e?.status ?? e?.response?.status
            setLk({
                stage: "error",
                msg: s === 404
                    ? "User not found — double-check the ID."
                    : s === 403
                    ? "Profile is private (no shared server). You can still add by ID."
                    : `Request failed${s ? ` (${s})` : ""} — try again.`,
            })
        }
    }

    const doAdd = () => {
        if (lk.stage !== "found") return
        addUser(settings, cleanId, label.trim())
        setRawId(""); setLabel(""); setLk({ stage: "idle" })
        onAdded()
    }

    // step 2: preview + confirm
    if (lk.stage === "found") return (
        <div style={{ animation: "ur-in 0.18s ease" }}>
            <div style={{
                borderRadius: 10, overflow: "hidden", marginBottom: 16,
                border: "1px solid var(--background-modifier-accent)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}>
                {/* banner / color strip */}
                <div style={{
                    height: lk.banner ? 96 : 60,
                    position: "relative",
                    background: lk.banner
                        ? `url(${lk.banner}) center/cover no-repeat`
                        : lk.accent
                            ? `linear-gradient(135deg, ${lk.accent}bb, ${lk.accent}44)`
                            : "linear-gradient(135deg, #5865f2, #4752c4)",
                }}>
                    <img
                        src={lk.av}
                        style={{
                            position: "absolute", bottom: -22, left: 16,
                            width: 56, height: 56, borderRadius: "50%",
                            border: "4px solid var(--modal-background, var(--background-primary))",
                            objectFit: "cover",
                            boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
                        }}
                        onError={(e: any) => e.target.style.display = "none"}
                    />
                </div>

                <div style={{ padding: "28px 16px 16px", background: "var(--background-secondary)" }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--header-primary)" }}>
                        {lk.user.globalName || lk.user.username}
                    </div>
                    {lk.user.globalName && (
                        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                            @{lk.user.username}
                        </div>
                    )}
                    {lk.user.bio && (
                        <div style={{
                            fontSize: 13, color: "var(--text-normal)", marginTop: 8,
                            lineHeight: 1.4, opacity: 0.85,
                            display: "-webkit-box", WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                            {lk.user.bio}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--header-secondary)", marginBottom: 6 }}>
                Label <span style={{ fontWeight: 400, textTransform: "none", opacity: 0.5 }}>— optional</span>
            </div>
            <TextInput
                value={label}
                onChange={(v: string) => setLabel(v)}
                placeholder={'e.g. "my ex", "bestie", "coworker"'}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") doAdd() }}
                autoFocus
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, marginBottom: 16 }}>
                Only visible in your notifications — completely invisible to them
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={doAdd} size={Button.Sizes.MEDIUM} style={{ flex: 1 }}>
                    Add to Watchlist
                </Button>
                <Button
                    onClick={() => { setLk({ stage: "idle" }); setLabel("") }}
                    size={Button.Sizes.MEDIUM}
                    color={Button.Colors.TRANSPARENT}
                >
                    Cancel
                </Button>
            </div>
        </div>
    )

    // step 1: ID input
    return (
        <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--header-secondary)", marginBottom: 6 }}>
                User ID
            </div>
            <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                    <TextInput
                        value={rawId}
                        onChange={(v: string) => {
                            setRawId(v)
                            if (lk.stage === "error") setLk({ stage: "idle" })
                        }}
                        placeholder="e.g. 123456789012345678"
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") doLookup() }}
                        autoFocus
                    />
                </div>
                <Button
                    onClick={doLookup}
                    size={Button.Sizes.MEDIUM}
                    disabled={lk.stage === "loading" || !rawId.trim()}
                    style={{ flexShrink: 0 }}
                >
                    {lk.stage === "loading"
                        ? <><span className="ur-spinner" style={{ marginRight: 6 }} />Looking up…</>
                        : "Look Up"}
                </Button>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Enable <strong style={{ color: "var(--text-normal)" }}>Developer Mode</strong> in Discord settings → right-click any user → Copy User ID
            </div>

            {lk.stage === "error" && (
                <div style={{
                    display: "flex", gap: 9, alignItems: "flex-start",
                    marginTop: 12, padding: "10px 13px", borderRadius: 8,
                    background: "rgba(237,66,69,0.08)",
                    border: "1px solid rgba(237,66,69,0.3)",
                    animation: "ur-in 0.14s ease",
                }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
                    <span style={{ fontSize: 13, color: "var(--status-danger)" }}>{lk.msg}</span>
                </div>
            )}
        </div>
    )
}

// --- override chips ---

const OVERRIDE_ITEMS: { label: string; icon: string; key: keyof WatchedUser["overrides"]; gk: string }[] = [
    { label: "Messages", icon: "💬", key: "msgs",    gk: "globalMsgs"    },
    { label: "Edits",    icon: "✏️",  key: "edits",   gk: "globalEdits"   },
    { label: "Deletes",  icon: "🗑",  key: "deletes", gk: "globalDeletes" },
    { label: "Typing",   icon: "⌨️",  key: "typing",  gk: "globalTyping"  },
    { label: "Profile",  icon: "🪪",  key: "profile", gk: "globalProfile" },
    { label: "Voice",    icon: "🎙",  key: "voice",   gk: "globalVoice"   },
    { label: "Status",   icon: "🟢",  key: "status",  gk: "globalStatus"  },
]

// --- user card ---

function UserCard({ user, settings, onUpdate, onRemove }: {
    user: WatchedUser
    settings: any
    onUpdate: () => void
    onRemove: () => void
}) {
    const [nick, setNick]         = React.useState(user.nick)
    const [expanded, setExpanded] = React.useState(false)
    const [editNick, setEditNick] = React.useState(false)
    const du = UserStore.getUser(user.id)

    const av   = du ? du.getAvatarURL(undefined, 64, false) : avatarUrl(user.id, null)
    const name = displayName(du) || user.id

    const saveNick = () => {
        patchUser(settings, user.id, { nick })
        setEditNick(false)
        onUpdate()
    }

    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        onUpdate()
    }

    const hasOv = Object.values(user.overrides).some(v => v !== null)

    return (
        <div className="ur-card">
            {/* main row */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                {/* avatar */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <img
                        src={av}
                        style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", display: "block" }}
                        onError={(e: any) => e.target.style.display = "none"}
                    />
                    {hasOv && (
                        <div style={{
                            position: "absolute", bottom: 0, right: 0,
                            width: 10, height: 10, borderRadius: "50%",
                            background: "var(--brand-500)",
                            border: "2px solid var(--background-secondary)",
                        }} title="Has per-user overrides" />
                    )}
                </div>

                {/* name + id */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--header-primary)" }}>
                            {name}
                        </span>
                        {user.nick && (
                            <span style={{
                                fontSize: 11, fontWeight: 600, padding: "1px 8px",
                                borderRadius: 20, background: "rgba(88,101,242,0.18)",
                                color: "var(--brand-400)",
                            }}>
                                {user.nick}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {user.id} · added {new Date(user.addedAt).toLocaleDateString()}
                    </div>
                </div>

                {/* action buttons */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <IconBtn onClick={() => setEditNick(v => !v)} title="Edit label">✏️</IconBtn>
                    <IconBtn onClick={() => setExpanded(v => !v)} title="Per-user overrides">
                        {expanded ? "▲" : "▼"}
                    </IconBtn>
                    <IconBtn onClick={onRemove} title="Stop watching" danger>🗑</IconBtn>
                </div>
            </div>

            {/* label editor */}
            {editNick && (
                <div style={{
                    display: "flex", gap: 8, padding: "10px 14px 12px",
                    borderTop: "1px solid var(--background-modifier-accent)",
                    animation: "ur-in 0.14s ease",
                }}>
                    <div style={{ flex: 1 }}>
                        <TextInput
                            value={nick}
                            onChange={(v: string) => setNick(v)}
                            placeholder={`Label for ${name}`}
                            onKeyDown={(e: React.KeyboardEvent) => {
                                if (e.key === "Enter") saveNick()
                                if (e.key === "Escape") setEditNick(false)
                            }}
                            autoFocus
                        />
                    </div>
                    <Button size={Button.Sizes.MEDIUM} onClick={saveNick}>Save</Button>
                    <Button size={Button.Sizes.MEDIUM} color={Button.Colors.TRANSPARENT} onClick={() => setEditNick(false)}>
                        Cancel
                    </Button>
                </div>
            )}

            {/* overrides panel */}
            {expanded && (
                <div style={{ borderTop: "1px solid var(--background-modifier-accent)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 14px 6px" }}>
                        Click to override global setting for this person. Right-click to reset.
                    </div>
                    <div style={{
                        display: "grid", gridTemplateColumns: "1fr 1fr",
                        gap: 4, padding: "0 12px 10px",
                    }}>
                        {OVERRIDE_ITEMS.map(item => {
                            const isOn = featureOn(settings, user.id, item.key, item.gk)
                            const isOv = user.overrides[item.key] !== null

                            return (
                                <div
                                    key={item.key}
                                    title={isOv ? "Overriding global — right-click to reset" : "Using global setting"}
                                    onClick={() => {
                                        if (!isOv) setOv(item.key, !isOn)
                                        else if (user.overrides[item.key] === true) setOv(item.key, false)
                                        else setOv(item.key, null)
                                    }}
                                    onContextMenu={e => { e.preventDefault(); setOv(item.key, null) }}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 7,
                                        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                                        border: `1.5px solid ${isOn ? "rgba(88,101,242,0.45)" : "var(--background-modifier-accent)"}`,
                                        background: isOn ? "rgba(88,101,242,0.1)" : "var(--background-tertiary)",
                                        opacity: isOn ? 1 : 0.6,
                                        userSelect: "none",
                                        transition: "all 0.12s",
                                    }}
                                >
                                    <span style={{ fontSize: 13 }}>{item.icon}</span>
                                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: isOn ? "var(--text-normal)" : "var(--text-muted)" }}>
                                        {item.label}
                                    </span>
                                    {isOv && (
                                        <span style={{ fontSize: 7, color: "var(--brand-400)", marginRight: 2 }}>●</span>
                                    )}
                                    <Toggle on={isOn} onChange={v => setOv(item.key, isOv ? v : null)} />
                                </div>
                            )
                        })}
                    </div>
                    <div style={{ padding: "0 12px 12px" }}>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.TRANSPARENT}
                            onClick={() => {
                                const reset = Object.fromEntries(
                                    Object.keys(user.overrides).map(k => [k, null])
                                ) as WatchedUser["overrides"]
                                patchUser(settings, user.id, { overrides: reset })
                                onUpdate()
                            }}
                        >
                            ↩ Reset all overrides
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// --- watchlist tab ---

function WatchlistTab({ settings, onUpdate }: { settings: any; onUpdate: () => void }) {
    const [users, setUsers]   = React.useState<WatchedUser[]>(() => getWatchlist(settings))
    const [search, setSearch] = React.useState("")

    const refresh = () => { setUsers(getWatchlist(settings)); onUpdate() }

    const shown = search.trim()
        ? users.filter(u => {
            const du  = UserStore.getUser(u.id)
            const hay = [displayName(du), u.nick, u.id].join(" ").toLowerCase()
            return hay.includes(search.toLowerCase())
        })
        : users

    if (users.length === 0) return (
        <div style={{ textAlign: "center", padding: "44px 20px" }}>
            <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.6 }}>👁</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--header-primary)", marginBottom: 6 }}>
                Nobody on the watchlist
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Go to "Add User" to start tracking someone
            </div>
        </div>
    )

    return (
        <>
            {users.length > 3 && (
                <div style={{ marginBottom: 12 }}>
                    <TextInput
                        value={search}
                        onChange={(v: string) => setSearch(v)}
                        placeholder="Search by name, label, or ID…"
                    />
                </div>
            )}
            {shown.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "var(--text-muted)" }}>
                    No results for "{search}"
                </div>
            ) : (
                shown.map(u => (
                    <UserCard
                        key={u.id}
                        user={u}
                        settings={settings}
                        onUpdate={refresh}
                        onRemove={() => { removeUser(settings, u.id); refresh() }}
                    />
                ))
            )}
        </>
    )
}

// --- main modal ---

export function WatchlistModal({ modalProps, settings }: { modalProps: any; settings: any }) {
    injectStyles()

    const [tab,   setTab]   = React.useState<"list" | "add">("list")
    const [count, setCount] = React.useState(() => getWatchlist(settings).length)

    const refreshCount = () => setCount(getWatchlist(settings).length)

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <span style={{ fontSize: 20 }}>👁</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--header-primary)" }}>
                        UserRadar
                    </span>
                    {count > 0 && (
                        <span style={{
                            background: "var(--brand-500)", color: "#fff",
                            borderRadius: 10, fontSize: 11, fontWeight: 700,
                            padding: "1px 7px", minWidth: 20, textAlign: "center",
                        }}>
                            {count}
                        </span>
                    )}
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "4px 16px 24px" }}>
                {/* tabs */}
                <div style={{
                    display: "flex", gap: 2, padding: 3,
                    background: "var(--background-secondary)",
                    borderRadius: 10, marginBottom: 16,
                }}>
                    <TabBtn active={tab === "list"} onClick={() => setTab("list")}>
                        Watchlist{count > 0 ? ` (${count})` : ""}
                    </TabBtn>
                    <TabBtn active={tab === "add"} onClick={() => setTab("add")}>
                        + Add User
                    </TabBtn>
                </div>

                {tab === "list" && (
                    <WatchlistTab settings={settings} onUpdate={refreshCount} />
                )}
                {tab === "add" && (
                    <AddTab
                        settings={settings}
                        onAdded={() => { refreshCount(); setTab("list") }}
                    />
                )}
            </ModalContent>
        </ModalRoot>
    )
}// WatchlistModal.tsx

import { React } from "@webpack/common"
import { Button, Text, TextInput } from "@webpack/common"
import { UserStore, RestAPI } from "@webpack/common"
import { ModalRoot, ModalHeader, ModalContent, ModalSize } from "@utils/modal"

import { WatchedUser } from "./types"
import {
    getWatchlist, addUser, removeUser,
    patchUser, isWatched, camelize,
    displayName, featureOn
} from "./store"

// only animations and structural layout — zero color rules
// colors are all inline so the UA stylesheet can never win
const STYLE_ID = "ur-s4"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement("style")
    el.id = STYLE_ID
    el.textContent = `
        @keyframes ur-in   { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes ur-spin { to { transform: rotate(360deg) } }

        .ur-card {
            border-radius: 10px;
            border: 1px solid var(--background-modifier-accent);
            background: var(--background-secondary);
            margin-bottom: 8px;
            overflow: hidden;
            transition: border-color 0.15s, box-shadow 0.15s;
            animation: ur-in 0.15s ease;
        }
        .ur-card:hover {
            border-color: rgba(88, 101, 242, 0.45);
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
        }
        .ur-toggle {
            position: relative;
            width: 32px; height: 18px;
            border-radius: 9px;
            flex-shrink: 0;
            cursor: pointer;
            transition: background 0.15s;
        }
        .ur-knob {
            position: absolute;
            top: 2px;
            width: 14px; height: 14px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            transition: left 0.15s;
        }
        .ur-spinner {
            display: inline-block;
            width: 12px; height: 12px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            animation: ur-spin 0.6s linear infinite;
            vertical-align: middle;
        }
    `
    document.head.appendChild(el)
}

// --- CDN helpers ---

function avatarUrl(id: string, hash?: string | null, size = 80) {
    if (hash) {
        const ext = hash.startsWith("a_") ? "gif" : "webp"
        return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=${size}`
    }
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % 6n)}.png`
}

function bannerUrl(id: string, hash?: string | null) {
    if (!hash) return null
    return `https://cdn.discordapp.com/banners/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=480`
}

function toHex(n?: number | null) {
    if (n == null) return null
    return "#" + n.toString(16).padStart(6, "0")
}

// --- toggle ---
// has to be custom since discord's Switch component isn't cleanly exported
// inline background so no class-color issues

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            className="ur-toggle"
            style={{ background: on ? "var(--brand-500)" : "var(--background-modifier-accent)" }}
            onClick={e => { e.stopPropagation(); onChange(!on) }}
        >
            <div className="ur-knob" style={{ left: on ? 16 : 2 }} />
        </div>
    )
}

// --- icon button ---
// "all: unset" nukes every browser/UA default before we set anything
// this is the only reliable way to stop buttons from having black text

function IconBtn({
    onClick, title, danger = false, children
}: {
    onClick: () => void
    title?: string
    danger?: boolean
    children: React.ReactNode
}) {
    const [hovered, setHovered] = React.useState(false)

    const color = danger && hovered
        ? "var(--status-danger)"
        : hovered
            ? "var(--interactive-hover)"
            : "var(--interactive-normal)"

    const bg = danger && hovered
        ? "rgba(237,66,69,0.1)"
        : hovered
            ? "var(--background-modifier-hover)"
            : "transparent"

    return (
        <button
            title={title}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                all: "unset",
                cursor: "pointer",
                color,
                background: bg,
                borderRadius: 6,
                padding: "5px 8px",
                fontSize: 15,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.12s, color 0.12s",
                boxSizing: "border-box",
            } as React.CSSProperties}
        >
            {children}
        </button>
    )
}

// --- tab button ---

function TabBtn({
    active, onClick, children
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    const [hovered, setHovered] = React.useState(false)

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                all: "unset",
                flex: 1,
                textAlign: "center",
                padding: "7px 0",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active
                    ? "var(--header-primary)"
                    : hovered
                        ? "var(--text-normal)"
                        : "var(--text-muted)",
                background: active
                    ? "var(--background-primary)"
                    : hovered
                        ? "var(--background-modifier-hover)"
                        : "transparent",
                boxShadow: active ? "0 1px 4px rgba(0,0,0,0.2)" : "none",
                transition: "background 0.12s, color 0.12s",
                boxSizing: "border-box",
            } as React.CSSProperties}
        >
            {children}
        </button>
    )
}

// --- ADD TAB ---

type LookupState =
    | { stage: "idle" }
    | { stage: "loading" }
    | { stage: "found"; user: any; av: string; banner: string | null; accent: string | null }
    | { stage: "error"; msg: string }

function AddTab({ settings, onAdded }: { settings: any; onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupState>({ stage: "idle" })

    const cleanId = rawId.trim().replace(/\D/g, "")

    const doLookup = async () => {
        if (!cleanId)
            return setLk({ stage: "error", msg: "Paste a user ID first." })
        if (cleanId.length < 17 || cleanId.length > 20)
            return setLk({ stage: "error", msg: "Discord IDs are 17–20 digits — double-check that." })
        if (isWatched(settings, cleanId))
            return setLk({ stage: "error", msg: "Already watching this person." })

        setLk({ stage: "loading" })
        try {
            const { body } = await RestAPI.get({
                url: `/users/${cleanId}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            })
            const d = camelize(body)
            setLk({
                stage: "found",
                user: d.user,
                av: avatarUrl(d.user.id, d.user.avatar, 128),
                banner: bannerUrl(d.user.id, d.user.banner),
                accent: toHex(d.user.accentColor),
            })
        } catch (e: any) {
            const s = e?.status ?? e?.response?.status
            setLk({
                stage: "error",
                msg: s === 404
                    ? "User not found — double-check the ID."
                    : s === 403
                    ? "Profile is private (no shared server). You can still add by ID."
                    : `Request failed${s ? ` (${s})` : ""} — try again.`,
            })
        }
    }

    const doAdd = () => {
        if (lk.stage !== "found") return
        addUser(settings, cleanId, label.trim())
        setRawId(""); setLabel(""); setLk({ stage: "idle" })
        onAdded()
    }

    // step 2: preview + confirm
    if (lk.stage === "found") return (
        <div style={{ animation: "ur-in 0.18s ease" }}>
            <div style={{
                borderRadius: 10, overflow: "hidden", marginBottom: 16,
                border: "1px solid var(--background-modifier-accent)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}>
                {/* banner / color strip */}
                <div style={{
                    height: lk.banner ? 96 : 60,
                    position: "relative",
                    background: lk.banner
                        ? `url(${lk.banner}) center/cover no-repeat`
                        : lk.accent
                            ? `linear-gradient(135deg, ${lk.accent}bb, ${lk.accent}44)`
                            : "linear-gradient(135deg, #5865f2, #4752c4)",
                }}>
                    <img
                        src={lk.av}
                        style={{
                            position: "absolute", bottom: -22, left: 16,
                            width: 56, height: 56, borderRadius: "50%",
                            border: "4px solid var(--modal-background, var(--background-primary))",
                            objectFit: "cover",
                            boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
                        }}
                        onError={(e: any) => e.target.style.display = "none"}
                    />
                </div>

                <div style={{ padding: "28px 16px 16px", background: "var(--background-secondary)" }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--header-primary)" }}>
                        {lk.user.globalName || lk.user.username}
                    </div>
                    {lk.user.globalName && (
                        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                            @{lk.user.username}
                        </div>
                    )}
                    {lk.user.bio && (
                        <div style={{
                            fontSize: 13, color: "var(--text-normal)", marginTop: 8,
                            lineHeight: 1.4, opacity: 0.85,
                            display: "-webkit-box", WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                            {lk.user.bio}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--header-secondary)", marginBottom: 6 }}>
                Label <span style={{ fontWeight: 400, textTransform: "none", opacity: 0.5 }}>— optional</span>
            </div>
            <TextInput
                value={label}
                onChange={(v: string) => setLabel(v)}
                placeholder={'e.g. "my ex", "bestie", "coworker"'}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") doAdd() }}
                autoFocus
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 5, marginBottom: 16 }}>
                Only visible in your notifications — completely invisible to them
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <Button onClick={doAdd} size={Button.Sizes.MEDIUM} style={{ flex: 1 }}>
                    Add to Watchlist
                </Button>
                <Button
                    onClick={() => { setLk({ stage: "idle" }); setLabel("") }}
                    size={Button.Sizes.MEDIUM}
                    color={Button.Colors.TRANSPARENT}
                >
                    Cancel
                </Button>
            </div>
        </div>
    )

    // step 1: ID input
    return (
        <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--header-secondary)", marginBottom: 6 }}>
                User ID
            </div>
            <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                    <TextInput
                        value={rawId}
                        onChange={(v: string) => {
                            setRawId(v)
                            if (lk.stage === "error") setLk({ stage: "idle" })
                        }}
                        placeholder="e.g. 123456789012345678"
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") doLookup() }}
                        autoFocus
                    />
                </div>
                <Button
                    onClick={doLookup}
                    size={Button.Sizes.MEDIUM}
                    disabled={lk.stage === "loading" || !rawId.trim()}
                    style={{ flexShrink: 0 }}
                >
                    {lk.stage === "loading"
                        ? <><span className="ur-spinner" style={{ marginRight: 6 }} />Looking up…</>
                        : "Look Up"}
                </Button>
            </div>

            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                Enable <strong style={{ color: "var(--text-normal)" }}>Developer Mode</strong> in Discord settings → right-click any user → Copy User ID
            </div>

            {lk.stage === "error" && (
                <div style={{
                    display: "flex", gap: 9, alignItems: "flex-start",
                    marginTop: 12, padding: "10px 13px", borderRadius: 8,
                    background: "rgba(237,66,69,0.08)",
                    border: "1px solid rgba(237,66,69,0.3)",
                    animation: "ur-in 0.14s ease",
                }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
                    <span style={{ fontSize: 13, color: "var(--status-danger)" }}>{lk.msg}</span>
                </div>
            )}
        </div>
    )
}

// --- override chips ---

const OVERRIDE_ITEMS: { label: string; icon: string; key: keyof WatchedUser["overrides"]; gk: string }[] = [
    { label: "Messages", icon: "💬", key: "msgs",    gk: "globalMsgs"    },
    { label: "Edits",    icon: "✏️",  key: "edits",   gk: "globalEdits"   },
    { label: "Deletes",  icon: "🗑",  key: "deletes", gk: "globalDeletes" },
    { label: "Typing",   icon: "⌨️",  key: "typing",  gk: "globalTyping"  },
    { label: "Profile",  icon: "🪪",  key: "profile", gk: "globalProfile" },
    { label: "Voice",    icon: "🎙",  key: "voice",   gk: "globalVoice"   },
    { label: "Status",   icon: "🟢",  key: "status",  gk: "globalStatus"  },
]

// --- user card ---

function UserCard({ user, settings, onUpdate, onRemove }: {
    user: WatchedUser
    settings: any
    onUpdate: () => void
    onRemove: () => void
}) {
    const [nick, setNick]         = React.useState(user.nick)
    const [expanded, setExpanded] = React.useState(false)
    const [editNick, setEditNick] = React.useState(false)
    const du = UserStore.getUser(user.id)

    const av   = du ? du.getAvatarURL(undefined, 64, false) : avatarUrl(user.id, null)
    const name = displayName(du) || user.id

    const saveNick = () => {
        patchUser(settings, user.id, { nick })
        setEditNick(false)
        onUpdate()
    }

    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        onUpdate()
    }

    const hasOv = Object.values(user.overrides).some(v => v !== null)

    return (
        <div className="ur-card">
            {/* main row */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                {/* avatar */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <img
                        src={av}
                        style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", display: "block" }}
                        onError={(e: any) => e.target.style.display = "none"}
                    />
                    {hasOv && (
                        <div style={{
                            position: "absolute", bottom: 0, right: 0,
                            width: 10, height: 10, borderRadius: "50%",
                            background: "var(--brand-500)",
                            border: "2px solid var(--background-secondary)",
                        }} title="Has per-user overrides" />
                    )}
                </div>

                {/* name + id */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--header-primary)" }}>
                            {name}
                        </span>
                        {user.nick && (
                            <span style={{
                                fontSize: 11, fontWeight: 600, padding: "1px 8px",
                                borderRadius: 20, background: "rgba(88,101,242,0.18)",
                                color: "var(--brand-400)",
                            }}>
                                {user.nick}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {user.id} · added {new Date(user.addedAt).toLocaleDateString()}
                    </div>
                </div>

                {/* action buttons */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <IconBtn onClick={() => setEditNick(v => !v)} title="Edit label">✏️</IconBtn>
                    <IconBtn onClick={() => setExpanded(v => !v)} title="Per-user overrides">
                        {expanded ? "▲" : "▼"}
                    </IconBtn>
                    <IconBtn onClick={onRemove} title="Stop watching" danger>🗑</IconBtn>
                </div>
            </div>

            {/* label editor */}
            {editNick && (
                <div style={{
                    display: "flex", gap: 8, padding: "10px 14px 12px",
                    borderTop: "1px solid var(--background-modifier-accent)",
                    animation: "ur-in 0.14s ease",
                }}>
                    <div style={{ flex: 1 }}>
                        <TextInput
                            value={nick}
                            onChange={(v: string) => setNick(v)}
                            placeholder={`Label for ${name}`}
                            onKeyDown={(e: React.KeyboardEvent) => {
                                if (e.key === "Enter") saveNick()
                                if (e.key === "Escape") setEditNick(false)
                            }}
                            autoFocus
                        />
                    </div>
                    <Button size={Button.Sizes.MEDIUM} onClick={saveNick}>Save</Button>
                    <Button size={Button.Sizes.MEDIUM} color={Button.Colors.TRANSPARENT} onClick={() => setEditNick(false)}>
                        Cancel
                    </Button>
                </div>
            )}

            {/* overrides panel */}
            {expanded && (
                <div style={{ borderTop: "1px solid var(--background-modifier-accent)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 14px 6px" }}>
                        Click to override global setting for this person. Right-click to reset.
                    </div>
                    <div style={{
                        display: "grid", gridTemplateColumns: "1fr 1fr",
                        gap: 4, padding: "0 12px 10px",
                    }}>
                        {OVERRIDE_ITEMS.map(item => {
                            const isOn = featureOn(settings, user.id, item.key, item.gk)
                            const isOv = user.overrides[item.key] !== null

                            return (
                                <div
                                    key={item.key}
                                    title={isOv ? "Overriding global — right-click to reset" : "Using global setting"}
                                    onClick={() => {
                                        if (!isOv) setOv(item.key, !isOn)
                                        else if (user.overrides[item.key] === true) setOv(item.key, false)
                                        else setOv(item.key, null)
                                    }}
                                    onContextMenu={e => { e.preventDefault(); setOv(item.key, null) }}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 7,
                                        padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                                        border: `1.5px solid ${isOn ? "rgba(88,101,242,0.45)" : "var(--background-modifier-accent)"}`,
                                        background: isOn ? "rgba(88,101,242,0.1)" : "var(--background-tertiary)",
                                        opacity: isOn ? 1 : 0.6,
                                        userSelect: "none",
                                        transition: "all 0.12s",
                                    }}
                                >
                                    <span style={{ fontSize: 13 }}>{item.icon}</span>
                                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: isOn ? "var(--text-normal)" : "var(--text-muted)" }}>
                                        {item.label}
                                    </span>
                                    {isOv && (
                                        <span style={{ fontSize: 7, color: "var(--brand-400)", marginRight: 2 }}>●</span>
                                    )}
                                    <Toggle on={isOn} onChange={v => setOv(item.key, isOv ? v : null)} />
                                </div>
                            )
                        })}
                    </div>
                    <div style={{ padding: "0 12px 12px" }}>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.TRANSPARENT}
                            onClick={() => {
                                const reset = Object.fromEntries(
                                    Object.keys(user.overrides).map(k => [k, null])
                                ) as WatchedUser["overrides"]
                                patchUser(settings, user.id, { overrides: reset })
                                onUpdate()
                            }}
                        >
                            ↩ Reset all overrides
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// --- watchlist tab ---

function WatchlistTab({ settings, onUpdate }: { settings: any; onUpdate: () => void }) {
    const [users, setUsers]   = React.useState<WatchedUser[]>(() => getWatchlist(settings))
    const [search, setSearch] = React.useState("")

    const refresh = () => { setUsers(getWatchlist(settings)); onUpdate() }

    const shown = search.trim()
        ? users.filter(u => {
            const du  = UserStore.getUser(u.id)
            const hay = [displayName(du), u.nick, u.id].join(" ").toLowerCase()
            return hay.includes(search.toLowerCase())
        })
        : users

    if (users.length === 0) return (
        <div style={{ textAlign: "center", padding: "44px 20px" }}>
            <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.6 }}>👁</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--header-primary)", marginBottom: 6 }}>
                Nobody on the watchlist
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Go to "Add User" to start tracking someone
            </div>
        </div>
    )

    return (
        <>
            {users.length > 3 && (
                <div style={{ marginBottom: 12 }}>
                    <TextInput
                        value={search}
                        onChange={(v: string) => setSearch(v)}
                        placeholder="Search by name, label, or ID…"
                    />
                </div>
            )}
            {shown.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "var(--text-muted)" }}>
                    No results for "{search}"
                </div>
            ) : (
                shown.map(u => (
                    <UserCard
                        key={u.id}
                        user={u}
                        settings={settings}
                        onUpdate={refresh}
                        onRemove={() => { removeUser(settings, u.id); refresh() }}
                    />
                ))
            )}
        </>
    )
}

// --- main modal ---

export function WatchlistModal({ modalProps, settings }: { modalProps: any; settings: any }) {
    injectStyles()

    const [tab,   setTab]   = React.useState<"list" | "add">("list")
    const [count, setCount] = React.useState(() => getWatchlist(settings).length)

    const refreshCount = () => setCount(getWatchlist(settings).length)

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <span style={{ fontSize: 20 }}>👁</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--header-primary)" }}>
                        UserRadar
                    </span>
                    {count > 0 && (
                        <span style={{
                            background: "var(--brand-500)", color: "#fff",
                            borderRadius: 10, fontSize: 11, fontWeight: 700,
                            padding: "1px 7px", minWidth: 20, textAlign: "center",
                        }}>
                            {count}
                        </span>
                    )}
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "4px 16px 24px" }}>
                {/* tabs */}
                <div style={{
                    display: "flex", gap: 2, padding: 3,
                    background: "var(--background-secondary)",
                    borderRadius: 10, marginBottom: 16,
                }}>
                    <TabBtn active={tab === "list"} onClick={() => setTab("list")}>
                        Watchlist{count > 0 ? ` (${count})` : ""}
                    </TabBtn>
                    <TabBtn active={tab === "add"} onClick={() => setTab("add")}>
                        + Add User
                    </TabBtn>
                </div>

                {tab === "list" && (
                    <WatchlistTab settings={settings} onUpdate={refreshCount} />
                )}
                {tab === "add" && (
                    <AddTab
                        settings={settings}
                        onAdded={() => { refreshCount(); setTab("list") }}
                    />
                )}
            </ModalContent>
        </ModalRoot>
    )
}// WatchlistModal.tsx

import { React } from "@webpack/common"
import { Button, Text, TextInput } from "@webpack/common"
import { UserStore, RestAPI } from "@webpack/common"
import { ModalRoot, ModalHeader, ModalContent, ModalSize } from "@utils/modal"

import { WatchedUser } from "./types"
import {
    getWatchlist, addUser, removeUser,
    patchUser, isWatched, camelize,
    displayName, featureOn
} from "./store"

// injected once — only layout/animation stuff, NO color overrides
// colors come from discord's own variables or component theming
const STYLE_ID = "ur-s3"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement("style")
    el.id = STYLE_ID
    el.textContent = `
        @keyframes ur-in   { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
        @keyframes ur-spin { to{transform:rotate(360deg)} }

        .ur-tabs {
            display: flex;
            background: var(--background-secondary);
            border-radius: 10px;
            padding: 3px;
            gap: 2px;
            margin-bottom: 16px;
        }
        .ur-tab {
            flex: 1; border: none; border-radius: 8px;
            padding: 7px 0; font-size: 13px; font-weight: 500;
            font-family: inherit; cursor: pointer;
            background: transparent;
            color: var(--text-muted);
            transition: background 0.12s, color 0.12s;
        }
        .ur-tab:hover  { background: var(--background-modifier-hover); color: var(--text-normal); }
        .ur-tab.active {
            background: var(--background-primary);
            color: var(--header-primary);
            font-weight: 600;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }

        .ur-card {
            border-radius: 10px;
            border: 1px solid var(--background-modifier-accent);
            background: var(--background-secondary);
            margin-bottom: 8px;
            overflow: hidden;
            transition: border-color 0.15s, box-shadow 0.15s;
            animation: ur-in 0.16s ease;
        }
        .ur-card:hover {
            border-color: rgba(88,101,242,0.4);
            box-shadow: 0 2px 12px rgba(0,0,0,0.12);
        }
        .ur-card-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
        }
        .ur-divider {
            border: none;
            border-top: 1px solid var(--background-modifier-accent);
            margin: 0;
        }

        .ur-overrides {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
            padding: 10px 12px 12px;
        }
        .ur-chip {
            display: flex; align-items: center; gap: 7px;
            padding: 8px 10px; border-radius: 8px; cursor: pointer;
            border: 1.5px solid var(--background-modifier-accent);
            background: var(--background-tertiary);
            color: var(--text-muted);
            font-size: 12px; font-weight: 500;
            user-select: none;
            transition: all 0.12s;
        }
        .ur-chip:hover { background: var(--background-modifier-hover); }
        .ur-chip.on {
            border-color: rgba(88,101,242,0.45);
            background: rgba(88,101,242,0.1);
            color: var(--text-normal);
        }
        .ur-chip.off { opacity: 0.55; }

        .ur-toggle {
            position: relative; width: 32px; height: 18px;
            border-radius: 9px; cursor: pointer;
            transition: background 0.16s; flex-shrink: 0;
        }
        .ur-knob {
            position: absolute; top: 2px;
            width: 14px; height: 14px; border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.25);
            transition: left 0.16s;
        }

        .ur-nick-pill {
            font-size: 11px; font-weight: 600;
            padding: 1px 8px; border-radius: 20px;
            background: rgba(88,101,242,0.18);
            color: var(--brand-400);
        }
        .ur-ov-dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: var(--brand-500);
            border: 2px solid var(--background-secondary);
            position: absolute; bottom: 0; right: 0;
        }

        .ur-spinner {
            width: 13px; height: 13px; border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            animation: ur-spin 0.6s linear infinite;
            display: inline-block; vertical-align: middle;
        }

        .ur-preview-banner { position: relative; }
        .ur-preview-avatar {
            position: absolute; bottom: -22px; left: 16px;
            width: 56px; height: 56px; border-radius: 50%;
            border: 4px solid var(--modal-background, var(--background-primary));
            object-fit: cover;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .ur-preview-info {
            padding: 30px 16px 16px;
        }

        .ur-badge {
            display: inline-flex; align-items: center; justify-content: center;
            background: var(--brand-500); color: #fff;
            border-radius: 10px; font-size: 11px; font-weight: 700;
            padding: 1px 7px; min-width: 20px;
        }

        .ur-error {
            display: flex; gap: 9px; align-items: flex-start;
            padding: 10px 13px; border-radius: 8px; margin-top: 10px;
            background: rgba(237,66,69,0.08);
            border: 1px solid rgba(237,66,69,0.3);
            animation: ur-in 0.14s ease;
            font-size: 13px;
            color: var(--status-danger);
        }

        .ur-empty {
            text-align: center;
            padding: 44px 20px;
        }

        .ur-section-label {
            display: block;
            font-size: 11px; font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.07em;
            color: var(--header-secondary);
            margin-bottom: 6px;
        }
    `
    document.head.appendChild(el)
}

// --- helpers ---

function avatarUrl(id: string, hash?: string | null, size = 80) {
    if (hash) {
        const ext = hash.startsWith("a_") ? "gif" : "webp"
        return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}?size=${size}`
    }
    return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % 6n)}.png`
}

function bannerUrl(id: string, hash?: string | null) {
    if (!hash) return null
    const ext = hash.startsWith("a_") ? "gif" : "webp"
    return `https://cdn.discordapp.com/banners/${id}/${hash}.${ext}?size=480`
}

function toHex(n?: number | null) {
    if (n == null) return null
    return "#" + n.toString(16).padStart(6, "0")
}

// --- toggle (this one has to be custom, discord doesn't expose their Switch nicely) ---

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <div
            className="ur-toggle"
            style={{ background: on ? "var(--brand-500)" : "var(--background-modifier-accent)" }}
            onClick={e => { e.stopPropagation(); onChange(!on) }}
        >
            <div className="ur-knob" style={{ left: on ? 16 : 2 }} />
        </div>
    )
}

// --- ADD TAB ---

type LookupState =
    | { stage: "idle" }
    | { stage: "loading" }
    | { stage: "found"; user: any; av: string; banner: string | null; accent: string | null }
    | { stage: "error"; msg: string }

function AddTab({ settings, onAdded }: { settings: any; onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupState>({ stage: "idle" })

    const cleanId = rawId.trim().replace(/\D/g, "")

    const doLookup = async () => {
        if (!cleanId)
            return setLk({ stage: "error", msg: "Paste a user ID first." })
        if (cleanId.length < 17 || cleanId.length > 20)
            return setLk({ stage: "error", msg: "Discord IDs are 17–20 digits — double-check that." })
        if (isWatched(settings, cleanId))
            return setLk({ stage: "error", msg: "Already watching this person." })

        setLk({ stage: "loading" })
        try {
            const { body } = await RestAPI.get({
                url: `/users/${cleanId}/profile`,
                query: { with_mutual_guilds: false, with_mutual_friends_count: false },
            })
            const d = camelize(body)
            setLk({
                stage: "found",
                user: d.user,
                av: avatarUrl(d.user.id, d.user.avatar, 128),
                banner: bannerUrl(d.user.id, d.user.banner),
                accent: toHex(d.user.accentColor),
            })
        } catch (e: any) {
            const s = e?.status ?? e?.response?.status
            setLk({
                stage: "error",
                msg: s === 404
                    ? "User not found — double-check the ID."
                    : s === 403
                    ? "Profile is private (no shared server). You can still add by ID."
                    : `Request failed${s ? ` (${s})` : ""} — try again.`,
            })
        }
    }

    const doAdd = () => {
        if (lk.stage !== "found") return
        addUser(settings, cleanId, label.trim())
        setRawId(""); setLabel(""); setLk({ stage: "idle" })
        onAdded()
    }

    if (lk.stage === "found") return (
        <div style={{ animation: "ur-in 0.18s ease" }}>
            {/* profile preview */}
            <div style={{
                borderRadius: 10, overflow: "hidden", marginBottom: 16,
                border: "1px solid var(--background-modifier-accent)",
                boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            }}>
                <div
                    className="ur-preview-banner"
                    style={{
                        height: lk.banner ? 96 : 60,
                        background: lk.banner
                            ? `url(${lk.banner}) center/cover no-repeat`
                            : lk.accent
                                ? `linear-gradient(135deg, ${lk.accent}bb, ${lk.accent}44)`
                                : "linear-gradient(135deg, #5865f2, #4752c4)",
                    }}
                >
                    <img
                        className="ur-preview-avatar"
                        src={lk.av}
                        onError={(e: any) => e.target.style.display = "none"}
                    />
                </div>
                <div className="ur-preview-info" style={{ background: "var(--background-secondary)" }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: "var(--header-primary)" }}>
                        {lk.user.globalName || lk.user.username}
                    </div>
                    {lk.user.globalName && (
                        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 1 }}>
                            @{lk.user.username}
                        </div>
                    )}
                    {lk.user.bio && (
                        <div style={{
                            fontSize: 13, color: "var(--text-normal)", marginTop: 8,
                            lineHeight: 1.4, opacity: 0.85,
                            display: "-webkit-box",
                            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}>
                            {lk.user.bio}
                        </div>
                    )}
                </div>
            </div>

            <span className="ur-section-label">
                Label <span style={{ fontWeight: 400, textTransform: "none", opacity: 0.5 }}>— optional</span>
            </span>
            <TextInput
                value={label}
                onChange={(v: string) => setLabel(v)}
                placeholder={`e.g. "my ex", "bestie", "coworker"`}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") doAdd() }}
                autoFocus
            />
            <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", marginTop: 5, marginBottom: 16, display: "block" }}>
                Only visible in your notifications — completely invisible to them
            </Text>

            <div style={{ display: "flex", gap: 8 }}>
                <Button
                    onClick={doAdd}
                    size={Button.Sizes.MEDIUM}
                    style={{ flex: 1 }}
                >
                    Add to Watchlist
                </Button>
                <Button
                    onClick={() => { setLk({ stage: "idle" }); setLabel("") }}
                    size={Button.Sizes.MEDIUM}
                    color={Button.Colors.PRIMARY}
                    look={Button.Looks.OUTLINED}
                >
                    Cancel
                </Button>
            </div>
        </div>
    )

    return (
        <div>
            <span className="ur-section-label">User ID</span>
            <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                    <TextInput
                        value={rawId}
                        onChange={(v: string) => {
                            setRawId(v)
                            if (lk.stage === "error") setLk({ stage: "idle" })
                        }}
                        placeholder="e.g. 123456789012345678"
                        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") doLookup() }}
                        autoFocus
                    />
                </div>
                <Button
                    onClick={doLookup}
                    size={Button.Sizes.MEDIUM}
                    disabled={lk.stage === "loading" || !rawId.trim()}
                    style={{ flexShrink: 0 }}
                >
                    {lk.stage === "loading"
                        ? <><span className="ur-spinner" style={{ marginRight: 6 }} /> Looking up…</>
                        : "Look Up"}
                </Button>
            </div>

            <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", marginTop: 7, display: "block" }}>
                Enable <strong>Developer Mode</strong> in Discord settings → right-click any user → Copy User ID
            </Text>

            {lk.stage === "error" && (
                <div className="ur-error">
                    <span>⚠️</span>
                    <span>{lk.msg}</span>
                </div>
            )}
        </div>
    )
}

// --- OVERRIDE CHIP LIST ---

const OVERRIDE_ITEMS: { label: string; icon: string; key: keyof WatchedUser["overrides"]; gk: string }[] = [
    { label: "Messages", icon: "💬", key: "msgs",    gk: "globalMsgs"    },
    { label: "Edits",    icon: "✏️",  key: "edits",   gk: "globalEdits"   },
    { label: "Deletes",  icon: "🗑",  key: "deletes", gk: "globalDeletes" },
    { label: "Typing",   icon: "⌨️",  key: "typing",  gk: "globalTyping"  },
    { label: "Profile",  icon: "🪪",  key: "profile", gk: "globalProfile" },
    { label: "Voice",    icon: "🎙",  key: "voice",   gk: "globalVoice"   },
    { label: "Status",   icon: "🟢",  key: "status",  gk: "globalStatus"  },
]

// --- USER CARD ---

function UserCard({ user, settings, onUpdate, onRemove }: {
    user: WatchedUser
    settings: any
    onUpdate: () => void
    onRemove: () => void
}) {
    const [nick, setNick]         = React.useState(user.nick)
    const [expanded, setExpanded] = React.useState(false)
    const [editNick, setEditNick] = React.useState(false)
    const du = UserStore.getUser(user.id)

    const av   = du ? du.getAvatarURL(undefined, 64, false) : avatarUrl(user.id, null)
    const name = displayName(du) || user.id

    const saveNick = () => {
        patchUser(settings, user.id, { nick })
        setEditNick(false)
        onUpdate()
    }

    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        onUpdate()
    }

    const hasOv = Object.values(user.overrides).some(v => v !== null)

    return (
        <div className="ur-card">
            <div className="ur-card-row">
                {/* avatar */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <img
                        src={av}
                        style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", display: "block" }}
                        onError={(e: any) => e.target.style.display = "none"}
                    />
                    {hasOv && <div className="ur-ov-dot" title="Has per-user overrides" />}
                </div>

                {/* name + id */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--header-primary)" }}>
                            {name}
                        </span>
                        {user.nick && <span className="ur-nick-pill">{user.nick}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {user.id} · added {new Date(user.addedAt).toLocaleDateString()}
                    </div>
                </div>

                {/* actions */}
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <Button
                        size={Button.Sizes.ICON}
                        color={Button.Colors.PRIMARY}
                        look={Button.Looks.BLANK}
                        onClick={() => setEditNick(v => !v)}
                        title="Edit label"
                    >
                        ✏️
                    </Button>
                    <Button
                        size={Button.Sizes.ICON}
                        color={Button.Colors.PRIMARY}
                        look={Button.Looks.BLANK}
                        onClick={() => setExpanded(v => !v)}
                        title="Per-user overrides"
                    >
                        {expanded ? "▲" : "▼"}
                    </Button>
                    <Button
                        size={Button.Sizes.ICON}
                        color={Button.Colors.RED}
                        look={Button.Looks.BLANK}
                        onClick={onRemove}
                        title="Stop watching"
                    >
                        🗑
                    </Button>
                </div>
            </div>

            {/* label editor */}
            {editNick && (
                <div style={{
                    display: "flex", gap: 8,
                    padding: "10px 14px 12px",
                    borderTop: "1px solid var(--background-modifier-accent)",
                    animation: "ur-in 0.14s ease",
                }}>
                    <div style={{ flex: 1 }}>
                        <TextInput
                            value={nick}
                            onChange={(v: string) => setNick(v)}
                            placeholder={`Label for ${name}`}
                            onKeyDown={(e: React.KeyboardEvent) => {
                                if (e.key === "Enter") saveNick()
                                if (e.key === "Escape") setEditNick(false)
                            }}
                            autoFocus
                        />
                    </div>
                    <Button size={Button.Sizes.MEDIUM} onClick={saveNick}>Save</Button>
                    <Button size={Button.Sizes.MEDIUM} color={Button.Colors.PRIMARY} look={Button.Looks.OUTLINED} onClick={() => setEditNick(false)}>✕</Button>
                </div>
            )}

            {/* overrides */}
            {expanded && (
                <div style={{ borderTop: "1px solid var(--background-modifier-accent)" }}>
                    <Text variant="text-xs/normal" style={{
                        color: "var(--text-muted)", display: "block",
                        margin: "8px 14px 4px",
                    }}>
                        Click a chip to override the global setting for this person only. Right-click to reset.
                    </Text>
                    <div className="ur-overrides">
                        {OVERRIDE_ITEMS.map(item => {
                            const isOn = featureOn(settings, user.id, item.key, item.gk)
                            const isOv = user.overrides[item.key] !== null
                            return (
                                <div
                                    key={item.key}
                                    className={`ur-chip ${isOn ? "on" : "off"}`}
                                    title={isOv ? "Overriding global — right-click to reset" : "Using global setting"}
                                    onClick={() => {
                                        if (!isOv) setOv(item.key, !isOn)
                                        else if (user.overrides[item.key] === true) setOv(item.key, false)
                                        else setOv(item.key, null)
                                    }}
                                    onContextMenu={e => { e.preventDefault(); setOv(item.key, null) }}
                                >
                                    <span style={{ fontSize: 13 }}>{item.icon}</span>
                                    <span style={{ flex: 1 }}>{item.label}</span>
                                    {isOv && <span style={{ fontSize: 7, color: "var(--brand-400)", marginRight: 2 }}>●</span>}
                                    <Toggle on={isOn} onChange={v => setOv(item.key, isOv ? v : null)} />
                                </div>
                            )
                        })}
                    </div>
                    <div style={{ padding: "0 12px 10px" }}>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            look={Button.Looks.OUTLINED}
                            onClick={() => {
                                const reset = Object.fromEntries(
                                    Object.keys(user.overrides).map(k => [k, null])
                                ) as WatchedUser["overrides"]
                                patchUser(settings, user.id, { overrides: reset })
                                onUpdate()
                            }}
                        >
                            ↩ Reset all overrides
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

// --- WATCHLIST TAB ---

function WatchlistTab({ settings, onUpdate }: { settings: any; onUpdate: () => void }) {
    const [users, setUsers]   = React.useState<WatchedUser[]>(() => getWatchlist(settings))
    const [search, setSearch] = React.useState("")

    const refresh = () => { setUsers(getWatchlist(settings)); onUpdate() }

    const shown = search.trim()
        ? users.filter(u => {
            const du = UserStore.getUser(u.id)
            const hay = [displayName(du), u.nick, u.id].join(" ").toLowerCase()
            return hay.includes(search.toLowerCase())
        })
        : users

    if (users.length === 0) return (
        <div className="ur-empty">
            <div style={{ fontSize: 44, marginBottom: 12, opacity: 0.6 }}>👁</div>
            <Text variant="text-lg/semibold" style={{ color: "var(--header-primary)", display: "block", marginBottom: 6 }}>
                Nobody on the watchlist
            </Text>
            <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                Go to "Add User" to start tracking someone
            </Text>
        </div>
    )

    return (
        <>
            {users.length > 3 && (
                <div style={{ marginBottom: 12 }}>
                    <TextInput
                        value={search}
                        onChange={(v: string) => setSearch(v)}
                        placeholder="Search by name, label, or ID…"
                    />
                </div>
            )}

            {shown.length === 0 ? (
                <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0", display: "block" }}>
                    No results for "{search}"
                </Text>
            ) : (
                shown.map(u => (
                    <UserCard
                        key={u.id}
                        user={u}
                        settings={settings}
                        onUpdate={refresh}
                        onRemove={() => { removeUser(settings, u.id); refresh() }}
                    />
                ))
            )}
        </>
    )
}

// --- MAIN MODAL ---

export function WatchlistModal({ modalProps, settings }: { modalProps: any; settings: any }) {
    injectStyles()

    const [tab,   setTab]   = React.useState<"list" | "add">("list")
    const [count, setCount] = React.useState(() => getWatchlist(settings).length)

    const refreshCount = () => setCount(getWatchlist(settings).length)

    return (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                    <span style={{ fontSize: 20 }}>👁</span>
                    <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }}>
                        UserRadar
                    </Text>
                    {count > 0 && <span className="ur-badge">{count}</span>}
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "4px 16px 24px" }}>
                <div className="ur-tabs">
                    <button
                        className={`ur-tab ${tab === "list" ? "active" : ""}`}
                        onClick={() => setTab("list")}
                    >
                        Watchlist{count > 0 ? ` (${count})` : ""}
                    </button>
                    <button
                        className={`ur-tab ${tab === "add" ? "active" : ""}`}
                        onClick={() => setTab("add")}
                    >
                        + Add User
                    </button>
                </div>

                {tab === "list" && (
                    <WatchlistTab settings={settings} onUpdate={refreshCount} />
                )}
                {tab === "add" && (
                    <AddTab
                        settings={settings}
                        onAdded={() => { refreshCount(); setTab("list") }}
                    />
                )}
            </ModalContent>
        </ModalRoot>
    )
}
