import { openUserProfile } from "@utils/discord"
import { React, showToast, UserStore } from "@webpack/common"

import { FALLBACK_AV, LITE_FEATURES } from "../constants"
import { isFeatureOn, labeledName, notify } from "../notify"
import { settings } from "../settings"
import { displayName, getWatchlist, patchUser, saveWatchlist } from "../store"
import { WatchedUser } from "../types"
import { avatarUrl, exactTime, timeAgo } from "../utils"
import { ActivityBadge } from "./ActivityLogFooter"
import { openActivityLog } from "./ActivityLogModal"
import { ico } from "./icons"
import { LabelInput } from "./inputs"
import { StatusBadgeIcon } from "./LogCard"
import { OV_GROUPS, OV_TAB_ICONS, OV_TAB_LABELS, OvTab } from "./overrides"
import { C } from "./theme"
import { Toggle } from "./Toggle"
import { useLiveStatus } from "./useLiveStatus"

export function previewNotification(uid: string, type: string) {
    const u = UserStore.getUser(uid)
    const dn = labeledName(uid, u)
    const icon = u ? avatarUrl(u.id, (u as any).avatar) : undefined

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
    }

    const p = previews[type] || { title: `${dn}: ${type}`, body: "preview notification" }
    notify({ title: "[Preview] " + p.title, body: p.body, icon })
}

export function WatchedRow({ user, refresh, expandedId, setExpandedId, onRemove, isPinned, onTogglePin, index }: {
    user: WatchedUser
    refresh: () => void
    expandedId: string | null
    setExpandedId: (id: string | null) => void
    onRemove: () => void
    isPinned?: boolean
    onTogglePin?: () => void
    index?: number
}) {
    const [nick,     setNick] = React.useState(user.nick || "")
    const expanded = expandedId === user.id
    const setExp = (v: boolean) => setExpandedId(v ? user.id : null)
    const [copied,   setCopy] = React.useState(false)
    const [ovTab,    setOvTab] = React.useState<OvTab>("messages")
    const liveStatus = useLiveStatus(user.id)

    const du   = UserStore.getUser(user.id)
    const name = displayName(du) || user.id
    const av   = du ? avatarUrl(du.id, (du as any).avatar, 64) : avatarUrl(user.id, null, 64)

    const saveNick = () => { patchUser(settings, user.id, { nick: (nick || "").slice(0, 50) }); refresh() }
    const setOv = (key: keyof WatchedUser["overrides"], val: boolean | null) => {
        patchUser(settings, user.id, { overrides: { ...user.overrides, [key]: val } })
        refresh()
        const u = UserStore.getUser(user.id)
        const dn = labeledName(user.id, u)
        const featLabel = OV_GROUPS.messages.find(r => r.key === key)?.label
            || OV_GROUPS.presence.find(r => r.key === key)?.label
            || OV_GROUPS.profile.find(r => r.key === key)?.label
            || key
        if (val === true) {
            showToast({ variant: "success", text: `${dn}: ${featLabel} enabled` })
        } else if (val === false) {
            showToast({ text: `${dn}: ${featLabel} disabled` })
        } else if (val === null) {
            showToast({ variant: "success", text: `${dn}: ${featLabel} reset to global` })
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
        saveWatchlist(settings, list)
        refresh()
        showToast({ variant: "success", text: `${labeledName(user.id, UserStore.getUser(user.id))}: all overrides reset` })
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
        saveWatchlist(settings, list)
        refresh()
        showToast({ variant: "success", text: `${labeledName(user.id, UserStore.getUser(user.id))}: all ${OV_TAB_LABELS[ovTab]} enabled` })
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
        saveWatchlist(settings, list)
        refresh()
        showToast({ text: `${labeledName(user.id, UserStore.getUser(user.id))}: all ${OV_TAB_LABELS[ovTab]} disabled` })
    }

    const applyPreset = (preset: "stalker" | "lite" | "silent") => {
        const u = UserStore.getUser(user.id)
        const dn = labeledName(user.id, u)
        showToast({ variant: "success", text: `${dn}: ${preset} preset applied` })
        const list = getWatchlist(settings)
        const idx = list.findIndex(u => u.id === user.id)
        if (idx === -1) return
        const overrides: any = {}
        for (const { key } of Object.values(OV_GROUPS).flat()) {
            overrides[key] = preset === "lite" ? LITE_FEATURES.includes(key) : true
        }
        // silent keeps logging on, it only mutes this user's notifications
        list[idx] = { ...list[idx], overrides, muted: preset === "silent" }
        saveWatchlist(settings, list)
        refresh()
    }

    const detectPreset = (): "stalker" | "lite" | "silent" | "custom" => {
        if (user.muted) return "silent"
        const allKeys = Object.values(OV_GROUPS).flat().map(r => r.key)
        const ov = user.overrides as any
        if (allKeys.every(k => ov[k] === true)) return "stalker"
        const isLite = LITE_FEATURES.every(k => ov[k] === true) &&
            allKeys.filter(k => !LITE_FEATURES.includes(k)).every(k => ov[k] === false)
        return isLite ? "lite" : "custom"
    }

    const activePreset = detectPreset()

    return (
        <div className={`ur-row${expanded ? " open" : ""}`} style={{
            borderRadius: 18,
            marginBottom: 8,
            animationDelay: `${Math.min(index ?? 0, 10) * 28}ms`,
        }}>
            <div className="ur-row-surface" style={{
                background: expanded
                    ? "linear-gradient(135deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.03) 100%)"
                    : "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                border: `1px solid ${isPinned ? C.brandLight + "60" : expanded ? C.bgEl : C.border}`,
                borderRadius: 18,
                overflow: "hidden",
            }}>
            <div className="ur-row-hover" onClick={() => setExp(!expanded)} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer",
                borderRadius: expanded ? "18px 18px 0 0" : 18, transition: "background 100ms",
            }}>
                <div
                    role="button"
                    title={isPinned ? "unpin" : "pin to top"}
                    onClick={(e: any) => { e.stopPropagation(); onTogglePin?.() }}
                    className={`ur-row-pin${isPinned ? " ur-pin-pop" : ""}`}
                    key={isPinned ? "pinned" : "unpinned"}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: isPinned ? C.brandLight : C.muted,
                        opacity: isPinned ? 1 : 0.35,
                        flexShrink: 0,
                        cursor: "pointer",
                        transition: "opacity 120ms, color 120ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "1" }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = isPinned ? "1" : "0.35" }}
                >
                    {isPinned ? <ico.pin /> : <ico.pinOutline />}
                </div>
                <div style={{ position: "relative", flexShrink: 0, width: 44, height: 44 }}>
                    <img className="ur-row-avatar" src={av} style={{
                        width: 44, height: 44, borderRadius: "50%", display: "block",
                        // cuts a notch out of the avatar for the status badge to sit in,
                        // same as real discord — center matches the badge below
                        WebkitMaskImage: "radial-gradient(circle 8px at calc(100% - 7px) calc(100% - 7px), transparent 8px, #000 8.5px)",
                        maskImage: "radial-gradient(circle 8px at calc(100% - 7px) calc(100% - 7px), transparent 8px, #000 8.5px)",
                    }}
                        onError={(e: any) => { e.target.src = FALLBACK_AV }} />
                    <span className="ur-status-dot" style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        overflow: "hidden",
                        boxShadow: liveStatus === "online" ? "0 0 6px #23a55a80" : liveStatus === "idle" ? "0 0 6px #f0b23280" : liveStatus === "dnd" ? "0 0 6px #da373c80" : "none",
                    }}>
                        <StatusBadgeIcon status={liveStatus} />
                    </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: C.header }}>{name}</span>
                        {user.nick && (
                            <span className="ur-badge-in ur-badge-glass" style={{ background: `${C.brand}30`, color: C.white, fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 20, textTransform: "uppercase", letterSpacing: 0.5, border: `1px solid ${C.brandLight}50`, boxShadow: `0 0 10px ${C.brand}30` }}>
                                {user.nick}
                            </span>
                        )}
                        {settings.store.globalPresetMode === "custom" && activePreset !== "custom" && (
                            <span className="ur-badge-glass" style={{
                                background: activePreset === "stalker" ? `${C.danger}25` : activePreset === "lite" ? `${C.brandLight}25` : `${C.muted}25`,
                                color: activePreset === "stalker" ? C.danger : activePreset === "lite" ? C.brandLight : C.muted,
                                fontSize: 9,
                                fontWeight: 800,
                                padding: "3px 8px",
                                borderRadius: 20,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                border: `1px solid ${activePreset === "stalker" ? `${C.danger}60` : activePreset === "lite" ? `${C.brandLight}60` : `${C.muted}60`}`,
                            }}>
                                {activePreset}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3, display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0 5px" }}>
                        <span style={{ fontFamily: "monospace", opacity: .7, whiteSpace: "nowrap" }}>{user.id}</span>
                        <span>·</span>
                        <span title={exactTime(user.addedAt)} style={{ whiteSpace: "nowrap" }}>{timeAgo(user.addedAt)}</span>
                    </div>
                </div>

                <div onClick={(e: any) => e.stopPropagation()} style={{ width: 80, flexShrink: 0 }}>
                    <LabelInput nick={nick} setNick={setNick} saveNick={saveNick} />
                </div>

                <div
                    onClick={(e: any) => {
                        e.stopPropagation();
                        openActivityLog(user.id);
                    }}
                    title="Full Activity History"
                    className="ur-activity-btn"
                    style={{
                        padding: "5px 12px",
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        background: "rgba(255,255,255,0.05)",
                        color: C.text,
                        border: `1px solid ${C.border}`,
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
                    <span>Activity</span>
                    <ActivityBadge userId={user.id} />
                </div>
                <div className={`ur-row-chevron${expanded ? " open" : ""}`}>
                    <ico.chevron />
                </div>

                <div onClick={(e: any) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    {[
                        { title: "copy id",       icon: copied ? <ico.check /> : <ico.copy />, color: copied ? C.green : C.muted, action: copyId },
                        { title: "open profile",  icon: <ico.external />,                       color: C.muted,                   action: () => openUserProfile(user.id) },
                        { title: "remove",        icon: <ico.trash />,                          color: C.red,                     action: onRemove },
                    ].map(btn => (
                        <div key={btn.title} role="button" tabIndex={0} title={btn.title}
                            className="ur-icon-btn"
                            onClick={btn.action}
                            onKeyDown={(e: any) => { if (e.key === "Enter") btn.action() }}
                            style={{ color: btn.color, cursor: "pointer", padding: 6, borderRadius: 6, display: "flex", alignItems: "center" }}
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
                    <div style={{ padding: "20px 16px 24px", borderTop: "1px solid rgba(255,255,255,0.04)", background: "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.14) 100%)" }}>
                        <div className="ur-glass" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, marginBottom: 18, background: "rgba(0,0,0,0.35)", padding: 4, borderRadius: 24, border: "1px solid rgba(255,255,255,0.06)", width: "fit-content", minWidth: 300, position: "relative" }}>
                            <div style={{
                                position: "absolute",
                                top: 4,
                                bottom: 4,
                                left: 4,
                                width: "calc((100% - 8px) / 3)",
                                transform: `translateX(${["messages", "presence", "profile"].indexOf(ovTab) * 100}%)`,
                                background: "linear-gradient(135deg, #5865f2 0%, #7289da 100%)",
                                borderRadius: 20,
                                boxShadow: "0 2px 12px rgba(88,101,242,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
                                border: "1px solid rgba(255,255,255,0.15)",
                                transition: "transform 300ms cubic-bezier(0.34,1.2,0.4,1)",
                                pointerEvents: "none",
                                boxSizing: "border-box",
                                zIndex: 1,
                            }} />
                            {(["messages", "presence", "profile"] as OvTab[]).map(tab => {
                                const TabIcon = OV_TAB_ICONS[tab]
                                const active = ovTab === tab
                                return (
                                    <div key={tab} className="ur-tab-btn" onClick={() => setOvTab(tab)} style={{
                                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                                        padding: "6px 14px", borderRadius: 20,
                                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                                        color: active ? "#fff" : C.muted,
                                        position: "relative", zIndex: 2,
                                        userSelect: "none",
                                    }}
                                        onMouseEnter={e => { if (!active) { e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.07)" } }}
                                        onMouseLeave={e => { if (!active) { e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "transparent" } }}
                                    >
                                        <span style={{ opacity: active ? 1 : 0.6, display: "flex", transition: "opacity 200ms ease" }}><TabIcon /></span>
                                        {OV_TAB_LABELS[tab]}
                                    </div>
                                )
                            })}
                        </div>
                        <div style={{ marginBottom: 18 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>Quick presets</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                {([
                                    { key: "stalker" as const, label: "Stalker", desc: "Every event", color: "#f04747", glow: "#f0474740" },
                                    { key: "lite" as const,    label: "Lite",    desc: "Essentials only", color: C.brand, glow: "#5865f240" },
                                    { key: "silent" as const,  label: "Silent",  desc: "No pings", color: "#949ba4", glow: "#949ba420" },
                                ]).map(preset => {
                                    const isActive = activePreset === preset.key
                                    return (
                                        <div key={preset.key} className="ur-preset-card ur-glass" onClick={() => applyPreset(preset.key)} style={{
                                            flex: 1, cursor: "pointer", padding: "12px 14px", borderRadius: 18,
                                            background: isActive ? `linear-gradient(145deg, ${preset.color}22 0%, ${preset.color}0d 100%)` : "rgba(255,255,255,0.03)",
                                            border: `1px solid ${isActive ? preset.color + "70" : "rgba(255,255,255,0.06)"}`,
                                            boxShadow: isActive ? `0 0 20px ${preset.glow}, inset 0 1px 0 rgba(255,255,255,0.08)` : "inset 0 1px 0 rgba(255,255,255,0.04)",
                                            transition: "all 220ms cubic-bezier(0.4,0,0.2,1)",
                                            backdropFilter: "blur(8px)",
                                        }}
                                            onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)" } }}
                                            onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)" } }}
                                        >
                                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: preset.color, boxShadow: isActive ? `0 0 8px ${preset.color}` : "none", flexShrink: 0, transition: "box-shadow 220ms" }} />
                                                <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? preset.color : C.text, transition: "color 220ms" }}>{preset.label}</span>
                                            </div>
                                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>{preset.desc}</div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.25)" }}>Overrides</span>
                            <div style={{ flex: 1 }} />
                            <span onClick={enableAll} style={{ fontSize: 11, color: C.brandLight, cursor: "pointer", fontWeight: 600, marginRight: 12 }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = "0.7" }} onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}>Enable All</span>
                            <span onClick={disableAll} style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", cursor: "pointer", fontWeight: 600 }}
                                onMouseEnter={e => { e.currentTarget.style.opacity = "0.7" }} onMouseLeave={e => { e.currentTarget.style.opacity = "1" }}>Disable All</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            {OV_GROUPS[ovTab].map(row => {
                                const isOn = isFeatureOn(user.id, row.key as any, row.gk)
                                const isOv = (user.overrides as any)[row.key] !== null && (user.overrides as any)[row.key] !== undefined
                                return (
                                    <div key={row.key}
                                        onClick={() => setOv(row.key as any, !isOn)}
                                        style={{
                                            background: isOn ? "linear-gradient(135deg, rgba(88,101,242,0.14) 0%, rgba(88,101,242,0.06) 100%)" : "rgba(255,255,255,0.025)",
                                            borderRadius: 16,
                                            border: `1px solid ${isOn && isOv ? "rgba(88,101,242,0.5)" : "rgba(255,255,255,0.06)"}`,
                                            boxShadow: isOn && isOv ? "0 0 16px rgba(88,101,242,0.18), inset 0 1px 0 rgba(255,255,255,0.08)" : "inset 0 1px 0 rgba(255,255,255,0.04)",
                                            padding: "10px 12px",
                                            cursor: "pointer",
                                            transition: "all 220ms cubic-bezier(0.4,0,0.2,1)",
                                            display: "flex", alignItems: "center", gap: 8,
                                            position: "relative", overflow: "hidden",
                                            backdropFilter: "blur(4px)",
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = isOn ? "linear-gradient(135deg, rgba(88,101,242,0.2) 0%, rgba(88,101,242,0.1) 100%)" : "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = isOn ? "rgba(88,101,242,0.6)" : "rgba(255,255,255,0.1)" }}
                                        onMouseLeave={e => { e.currentTarget.style.background = isOn ? "linear-gradient(135deg, rgba(88,101,242,0.14) 0%, rgba(88,101,242,0.06) 100%)" : "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = isOn && isOv ? "rgba(88,101,242,0.5)" : "rgba(255,255,255,0.06)" }}
                                    >
                                        {isOn && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "linear-gradient(180deg, #5865f2 0%, #7289da 100%)", borderRadius: "16px 0 0 16px", boxShadow: "0 0 10px #5865f2" }} />}
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
                                        onMouseEnter={e => { e.currentTarget.style.color = C.danger }}
                                        onMouseLeave={e => { e.currentTarget.style.color = C.muted }}
                                    >
                                        Reset to Default ↩
                                    </span>
                                </div>
                            </div>
                    </div>
                    </div>
                </div>
            </div>
    )
}
