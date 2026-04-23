// WatchlistModal.tsx

import { React } from "@webpack/common"
import { Button, TextInput } from "@webpack/common"
import { UserStore, RestAPI } from "@webpack/common"
import { ModalRoot, ModalHeader, ModalContent, ModalSize } from "@utils/modal"

import { WatchedUser } from "./types"
import {
    getWatchlist, addUser, removeUser,
    patchUser, isWatched, camelize,
    displayName, featureOn
} from "./store"

// only animations — no color rules at all
const STYLE_ID = "ur-s5"
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const el = document.createElement("style")
    el.id = STYLE_ID
    el.textContent = `
        @keyframes ur-in   { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes ur-spin { to{transform:rotate(360deg)} }
        .ur-card {
            border-radius:10px; overflow:hidden; margin-bottom:8px;
            border:1px solid var(--background-modifier-accent);
            background:var(--background-secondary);
            transition:border-color .15s,box-shadow .15s;
            animation:ur-in .15s ease;
        }
        .ur-card:hover { border-color:rgba(88,101,242,.4); box-shadow:0 2px 12px rgba(0,0,0,.15); }
        .ur-spinner {
            display:inline-block; width:12px; height:12px; border-radius:50%;
            border:2px solid rgba(255,255,255,.3); border-top-color:#fff;
            animation:ur-spin .6s linear infinite; vertical-align:middle;
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

// --- reusable clickable div (no UA stylesheet issues unlike <button>) ---
// role="button" + tabIndex for accessibility

function Clickable({
    onClick,
    style,
    title,
    children,
}: {
    onClick: () => void
    style?: React.CSSProperties
    title?: string
    children: React.ReactNode
}) {
    return (
        <div
            role="button"
            tabIndex={0}
            title={title}
            onClick={onClick}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onClick() }}
            style={{ cursor: "pointer", userSelect: "none", ...style }}
        >
            {children}
        </div>
    )
}

// --- toggle ---

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
    return (
        <Clickable
            onClick={() => onChange(!on)}
            style={{
                position: "relative",
                width: 32, height: 18,
                borderRadius: 9,
                background: on ? "var(--brand-500)" : "var(--background-modifier-accent)",
                flexShrink: 0,
                transition: "background .15s",
            }}
        >
            <div style={{
                position: "absolute", top: 2,
                left: on ? 16 : 2,
                width: 14, height: 14, borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                transition: "left .15s",
            }} />
        </Clickable>
    )
}

// --- tab pill ---

function Tab({ active, onClick, children }: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <Clickable
            onClick={onClick}
            style={{
                flex: 1,
                textAlign: "center",
                padding: "7px 0",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--header-primary)" : "var(--text-muted)",
                background: active ? "var(--background-primary)" : "transparent",
                boxShadow: active ? "0 1px 4px rgba(0,0,0,.2)" : "none",
                transition: "background .12s, color .12s",
            }}
        >
            {children}
        </Clickable>
    )
}

// --- icon action button (div, not button) ---

function IconAction({ onClick, title, danger, children }: {
    onClick: () => void
    title?: string
    danger?: boolean
    children: React.ReactNode
}) {
    const [hov, setHov] = React.useState(false)
    return (
        <Clickable
            onClick={onClick}
            title={title}
            style={{
                padding: "5px 7px",
                borderRadius: 6,
                fontSize: 15,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: danger && hov
                    ? "var(--status-danger)"
                    : hov
                        ? "var(--interactive-hover)"
                        : "var(--interactive-normal)",
                background: danger && hov
                    ? "rgba(237,66,69,.1)"
                    : hov
                        ? "var(--background-modifier-hover)"
                        : "transparent",
                transition: "background .12s, color .12s",
            }}
        >
            <div
                onMouseEnter={() => setHov(true)}
                onMouseLeave={() => setHov(false)}
                style={{ display: "contents" }}
            >
                {children}
            </div>
        </Clickable>
    )
}

// override chip — also a div

function Chip({ on, overridden, icon, label, onClick, onRightClick }: {
    on: boolean
    overridden: boolean
    icon: string
    label: string
    onClick: () => void
    onRightClick: () => void
}) {
    return (
        <Clickable
            onClick={onClick}
            style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "8px 10px", borderRadius: 8,
                border: `1.5px solid ${on ? "rgba(88,101,242,.45)" : "var(--background-modifier-accent)"}`,
                background: on ? "rgba(88,101,242,.1)" : "var(--background-tertiary)",
                opacity: on ? 1 : 0.6,
                transition: "all .12s",
            }}
            title={overridden ? "Overriding global — right-click to reset" : "Click to override global setting"}
        >
            {/* need a real div for onContextMenu since Clickable doesn't expose it */}
            <div
                style={{ display: "contents" }}
                onContextMenu={e => { e.preventDefault(); onRightClick() }}
            >
                <span style={{ fontSize: 13 }}>{icon}</span>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: on ? "var(--text-normal)" : "var(--text-muted)" }}>
                    {label}
                </span>
                {overridden && (
                    <span style={{ fontSize: 7, color: "var(--brand-400)", marginRight: 2 }}>●</span>
                )}
                <Toggle on={on} onChange={() => onClick()} />
            </div>
        </Clickable>
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

    // --- step 2: preview ---
    if (lk.stage === "found") return (
        <div style={{ animation: "ur-in .18s ease" }}>
            <div style={{
                borderRadius: 10, overflow: "hidden", marginBottom: 16,
                border: "1px solid var(--background-modifier-accent)",
                boxShadow: "0 4px 20px rgba(0,0,0,.2)",
            }}>
                <div style={{
                    height: lk.banner ? 96 : 60, position: "relative",
                    background: lk.banner
                        ? `url(${lk.banner}) center/cover no-repeat`
                        : lk.accent
                            ? `linear-gradient(135deg,${lk.accent}bb,${lk.accent}44)`
                            : "linear-gradient(135deg,#5865f2,#4752c4)",
                }}>
                    <img src={lk.av} style={{
                        position: "absolute", bottom: -22, left: 16,
                        width: 56, height: 56, borderRadius: "50%",
                        border: "4px solid var(--modal-background,var(--background-primary))",
                        objectFit: "cover", boxShadow: "0 2px 10px rgba(0,0,0,.3)",
                    }} onError={(e: any) => e.target.style.display = "none"} />
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
                            lineHeight: 1.4, opacity: .85,
                            display: "-webkit-box", WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>
                            {lk.user.bio}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--header-secondary)", marginBottom: 6 }}>
                Label&nbsp;
                <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-muted)", fontSize: 11 }}>
                    — optional
                </span>
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

    // --- step 1: ID input ---
    return (
        <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--header-secondary)", marginBottom: 6 }}>
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
                    background: "rgba(237,66,69,.08)",
                    border: "1px solid rgba(237,66,69,.3)",
                    animation: "ur-in .14s ease",
                }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
                    <span style={{ fontSize: 13, color: "var(--status-danger)" }}>{lk.msg}</span>
                </div>
            )}
        </div>
    )
}

// --- override items list ---

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

    const saveNick = () => { patchUser(settings, user.id, { nick }); setEditNick(false); onUpdate() }

    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        onUpdate()
    }

    const hasOv = Object.values(user.overrides).some(v => v !== null)

    return (
        <div className="ur-card">
            {/* main row */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
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
                        }} />
                    )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--header-primary)" }}>
                            {name}
                        </span>
                        {user.nick && (
                            <span style={{
                                fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 20,
                                background: "rgba(88,101,242,.18)", color: "var(--brand-400)",
                            }}>
                                {user.nick}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {user.id} · added {new Date(user.addedAt).toLocaleDateString()}
                    </div>
                </div>

                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <IconAction onClick={() => setEditNick(v => !v)} title="Edit label">✏️</IconAction>
                    <IconAction onClick={() => setExpanded(v => !v)} title="Per-user overrides">
                        <span style={{ color: "var(--interactive-normal)", fontSize: 11 }}>
                            {expanded ? "▲" : "▼"}
                        </span>
                    </IconAction>
                    <IconAction onClick={onRemove} title="Stop watching" danger>🗑</IconAction>
                </div>
            </div>

            {/* label editor */}
            {editNick && (
                <div style={{
                    display: "flex", gap: 8, padding: "10px 14px 12px",
                    borderTop: "1px solid var(--background-modifier-accent)",
                    animation: "ur-in .14s ease",
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

            {/* overrides */}
            {expanded && (
                <div style={{ borderTop: "1px solid var(--background-modifier-accent)" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 14px 6px" }}>
                        Click to override global setting per-person. Right-click a chip to reset it.
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "0 12px 10px" }}>
                        {OVERRIDE_ITEMS.map(item => {
                            const isOn = featureOn(settings, user.id, item.key, item.gk)
                            const isOv = user.overrides[item.key] !== null
                            return (
                                <Chip
                                    key={item.key}
                                    on={isOn}
                                    overridden={isOv}
                                    icon={item.icon}
                                    label={item.label}
                                    onClick={() => {
                                        if (!isOv) setOv(item.key, !isOn)
                                        else if (user.overrides[item.key] === true) setOv(item.key, false)
                                        else setOv(item.key, null)
                                    }}
                                    onRightClick={() => setOv(item.key, null)}
                                />
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
            <div style={{ fontSize: 44, marginBottom: 12, opacity: .6 }}>👁</div>
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
            {shown.length === 0
                ? <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "var(--text-muted)" }}>No results for "{search}"</div>
                : shown.map(u => (
                    <UserCard
                        key={u.id}
                        user={u}
                        settings={settings}
                        onUpdate={refresh}
                        onRemove={() => { removeUser(settings, u.id); refresh() }}
                    />
                ))
            }
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
                            padding: "1px 7px",
                        }}>
                            {count}
                        </span>
                    )}
                </div>
            </ModalHeader>

            <ModalContent style={{ padding: "4px 16px 24px" }}>
                {/* tabs — divs, not buttons */}
                <div style={{
                    display: "flex", gap: 2, padding: 3,
                    background: "var(--background-secondary)",
                    borderRadius: 10, marginBottom: 16,
                }}>
                    <Tab active={tab === "list"} onClick={() => setTab("list")}>
                        Watchlist{count > 0 ? ` (${count})` : ""}
                    </Tab>
                    <Tab active={tab === "add"} onClick={() => setTab("add")}>
                        + Add User
                    </Tab>
                </div>

                {tab === "list" && <WatchlistTab settings={settings} onUpdate={refreshCount} />}
                {tab === "add"  && <AddTab settings={settings} onAdded={() => { refreshCount(); setTab("list") }} />}
            </ModalContent>
        </ModalRoot>
    )
}
