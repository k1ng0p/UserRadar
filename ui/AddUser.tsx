import { React, RestAPI, UserStore } from "@webpack/common"

import { FALLBACK_AV } from "../constants"
import { fetchNewUserBaseline } from "../handlers/profile"
import { settings } from "../settings"
import { addUser, camelize, isWatched } from "../store"
import { avatarUrl, decodeSnowflake } from "../utils"
import { ico } from "./icons"
import { C } from "./theme"

export type LookupStage =
    | { s: "idle" }
    | { s: "loading" }
    | { s: "done"; user: any; av: string }
    | { s: "err"; msg: string }

export function AddUserInput({ rawId, setRawId, hasErr, lk, setLk, doLookup }: {
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

export function AddLabelInput({ label, setLabel, doAdd }: {
    label: string
    setLabel: (v: string) => void
    doAdd: () => void
}) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder='e.g. "bestie", "the rat", "ex"'
            maxLength={50}
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 50))}
            onKeyDown={(e) => { if (e.key === "Enter") doAdd() }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            style={{
                background: "#1e1f22",
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 40,
                boxSizing: "border-box",
                padding: "0 14px",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
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

export function AddUserSection({ onAdded }: { onAdded: () => void }) {
    const [rawId, setRawId] = React.useState("")
    const [label, setLabel] = React.useState("")
    const [lk, setLk]       = React.useState<LookupStage>({ s: "idle" })
    const [copiedId, setCopiedId] = React.useState(false)

    const cleanId = rawId.trim().replace(/\D/g, "")
    const hasErr  = lk.s === "err"

    const copyId = (id: string) => {
        navigator.clipboard.writeText(id)
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 1200)
    }

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
            if (code === 403) {
                // private profile, the id is still enough to track them
                const known = UserStore.getUser(cleanId)
                setLk({ s: "done", user: known ?? { id: cleanId, username: cleanId }, av: avatarUrl(cleanId, (known as any)?.avatar, 64) })
                return
            }
            setLk({
                s: "err",
                msg: code === 404 ? "user not found" : `request failed${code ? ` (${code})` : ""}`,
            })
        })
    }

    const doAdd = () => {
        if (lk.s !== "done") return
        addUser(settings, cleanId, label.trim().slice(0, 50))
        fetchNewUserBaseline(cleanId)
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
                        background: C.bg1,
                        borderRadius: 16,
                        border: `1px solid ${C.border}`,
                        marginBottom: 14,
                        overflow: "hidden",
                    }}>
                        <div style={{ padding: "12px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <img
                                    src={lk.av}
                                    style={{
                                        width: 52, height: 52,
                                        borderRadius: "50%",
                                        border: `2px solid ${C.border}`,
                                        flexShrink: 0,
                                        background: C.bg1,
                                    }}
                                    onError={(e: any) => { e.target.src = FALLBACK_AV }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                        <span style={{ fontSize: 17, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>
                                            {lk.user.globalName || lk.user.username}
                                        </span>
                                        {lk.user.globalName && (
                                            <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>@{lk.user.username}</span>
                                        )}
                                    </div>
                                    {lk.user.pronouns && (
                                        <div style={{ fontSize: 11, color: C.brandLight, marginTop: 2, fontWeight: 500 }}>
                                            {lk.user.pronouns}
                                        </div>
                                    )}
                                </div>
                                <div style={{
                                    width: 20, height: 20,
                                    borderRadius: "50%",
                                    background: "rgba(36,128,70,0.15)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                }}>
                                    <span style={{ color: C.green, display: "flex", transform: "scale(0.8)" }}><ico.check /></span>
                                </div>
                            </div>

                            {lk.user.bio && (
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 4 }}>
                                        About Me
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: C.text,
                                        lineHeight: 1.5,
                                        padding: "8px 10px",
                                        background: C.bg2,
                                        borderRadius: 8,
                                        border: `1px solid ${C.border}`,
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                    }}>
                                        {lk.user.bio}
                                    </div>
                                </div>
                            )}

                            <div style={{ height: 1, background: C.border, margin: "8px 0" }} />

                            {(() => {
                                const sf = decodeSnowflake(lk.user.id)
                                return sf && (
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 5 }}>
                                        Account Info
                                    </div>
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(2, 1fr)",
                                        gap: 6,
                                    }}>
                                        <div
                                            onClick={() => copyId(lk.user.id)}
                                            style={{
                                                padding: "8px 10px",
                                                background: C.bg2,
                                                borderRadius: 8,
                                                border: `1px solid ${C.border}`,
                                                cursor: "pointer",
                                                transition: "border-color 150ms ease, background 150ms ease",
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = "#232428" }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg2 }}
                                            title="Click to copy ID"
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>User ID</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.text, display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lk.user.id}</span>
                                                <span style={{ color: copiedId ? C.green : C.muted, flexShrink: 0, transition: "color 150ms ease", display: "flex" }}>
                                                    {copiedId ? <ico.check /> : <ico.copy />}
                                                </span>
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Created</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {sf.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                                                {sf.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                                            </div>
                                        </div>

                                        <div style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Account Age</div>
                                            <div style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>
                                                {(() => {
                                                    const diff = Date.now() - sf.timestamp
                                                    const years = Math.floor(diff / 31536000000)
                                                    const months = Math.floor((diff % 31536000000) / 2592000000)
                                                    const days = Math.floor((diff % 2592000000) / 86400000)
                                                    if (years > 0) return `${years}y ${months}mo`
                                                    if (months > 0) return `${months}mo ${days}d`
                                                    return `${days}d`
                                                })()}
                                            </div>
                                        </div>

                                        <div
                                            title={`Worker ${sf.workerId} · Process ${sf.processId} · Increment ${sf.increment}`}
                                            style={{ padding: "8px 10px", background: C.bg2, borderRadius: 8, border: `1px solid ${C.border}` }}
                                        >
                                            <div style={{ fontSize: 10, color: C.muted, marginBottom: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>Snowflake</div>
                                            <div style={{ fontSize: 11, fontFamily: "monospace", color: C.brandLight, fontWeight: 600 }}>
                                                w{sf.workerId} · p{sf.processId}
                                            </div>
                                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1, fontFamily: "monospace" }}>
                                                inc {sf.increment}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                )
                            })()}
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
