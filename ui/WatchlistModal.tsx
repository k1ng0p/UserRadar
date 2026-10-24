import { Modal, React, showToast, UserStore } from "@webpack/common"

import { activityStore } from "../activityStore"
import { purgeUserCaches } from "../caches"
import { getPinned, togglePin } from "../pins"
import { settings } from "../settings"
import { addUser, displayName, getWatchlist, isWatched, removeUser } from "../store"
import { injectStyles } from "../styles"
import { WatchedUser } from "../types"
import { AddUserSection } from "./AddUser"
import { GlobalPresetControl } from "./GlobalPresetControl"
import { ico } from "./icons"
import { SearchInput } from "./inputs"
import { C } from "./theme"
import { WatchedRow } from "./WatchedRow"

export type SortMode = "az" | "date"

export function WatchlistModal({ modalProps }: { modalProps: any }) {
    React.useEffect(() => { injectStyles() }, [])

    const [users, setUsers]       = React.useState<WatchedUser[]>(() => { try { return getWatchlist(settings) } catch { return [] } })
    const [query, setQuery]       = React.useState("")
    const [sort,  setSort]        = React.useState<SortMode>("date")
    const [expandedId, setExpandedId] = React.useState<string | null>(null)
    const [pinned, setPinned]     = React.useState<string[]>(() => getPinned())

    const refresh = () => { try { setUsers(getWatchlist(settings)) } catch { setUsers([]) } }

    const onTogglePin = (uid: string) => {
        togglePin(uid)
        setPinned(getPinned())
    }

    const shown = React.useMemo(() => {
        let list = users.filter(u => {
            if (!query.trim()) return true
            const q  = query.toLowerCase()
            const du = UserStore.getUser(u.id)
            return [displayName(du), u.nick ?? "", u.id].join(" ").toLowerCase().includes(q)
        })
        const sorted = sort === "az"
            ? [...list].sort((a, b) => (displayName(UserStore.getUser(a.id)) || a.id).localeCompare(displayName(UserStore.getUser(b.id)) || b.id))
            : [...list].sort((a, b) => b.addedAt - a.addedAt)
        // pinned users float to the top
        return [...sorted].sort((a, b) => {
            const ap = pinned.includes(a.id) ? 1 : 0
            const bp = pinned.includes(b.id) ? 1 : 0
            return bp - ap
        })
    }, [users, query, sort, pinned])

    return (
        <Modal
            {...modalProps}
            size="xl"
            title={
                <div className="ur-fade-in" style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                    <div className="ur-pulse" style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        background: C.bg2,
                        border: `1px solid ${C.border}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}>
                        <ico.eye />
                    </div>
                    <div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: C.header, lineHeight: 1.2 }}>UserRadar</div>
                        <div style={{ fontSize: 12, color: C.muted }}>watchlist manager</div>
                    </div>
                </div>
            }
            preview={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", width: "100%", gap: 8 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <button
                            onClick={() => {
                                const input = document.createElement("input")
                                input.type = "file"
                                input.accept = ".json"
                                input.onchange = async (e: any) => {
                                    const file = e.target.files[0]
                                    if (!file) return
                                    try {
                                        const text = await file.text()
                                        const data = JSON.parse(text)
                                        if (!Array.isArray(data)) throw new Error("Invalid format")
                                        let added = 0
                                        let skipped = 0
                                        for (const u of data) {
                                            // must be a real snowflake
                                            const id = typeof u?.id === "string" ? u.id.trim() : ""
                                            if (!/^\d{17,20}$/.test(id)) { skipped++; continue }
                                            if (isWatched(settings, id)) continue
                                            const nick = typeof u?.nick === "string" ? u.nick.trim().slice(0, 50) : ""
                                            addUser(settings, id, nick)
                                            added++
                                        }
                                        refresh()
                                        showToast({
                                            text: skipped > 0
                                                ? `Imported ${added} users, skipped ${skipped} invalid entries`
                                                : `Imported ${added} users to watchlist`,
                                            variant: "success",
                                        })
                                    } catch (err: any) {
                                        showToast({
                                            text: `Import failed: ${err.message || "Invalid file"}`,
                                            variant: "critical",
                                        })
                                    }
                                }
                                input.click()
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: 20,
                                background: "rgba(255,255,255,0.045)",
                                border: `1px solid ${C.border}`,
                                color: C.text,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                            className="ur-footer-btn"
                        >
                            <ico.download />
                            Import
                        </button>
                        <button
                            onClick={() => {
                                const list = getWatchlist(settings)
                                if (list.length === 0) {
                                    showToast({
                                        text: "Watchlist is empty",
                                        variant: "critical",
                                    })
                                    return
                                }
                                const data = JSON.stringify(list, null, 2)
                                const blob = new Blob([data], { type: "application/json" })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement("a")
                                a.href = url
                                a.download = `userradar_watchlist_${new Date().toISOString().slice(0,10)}.json`
                                a.click()
                                URL.revokeObjectURL(url)
                                showToast({
                                    text: `Exported ${list.length} users`,
                                    variant: "success",
                                })
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: 20,
                                background: "rgba(255,255,255,0.045)",
                                border: `1px solid ${C.border}`,
                                color: C.text,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                            className="ur-footer-btn"
                        >
                            <ico.upload />
                            Export
                        </button>
                        <button
                            onClick={() => {
                                if (confirm("Clear all activity logs for ALL watched users? This cannot be undone.")) {
                                    activityStore.clearAll().then(() => {
                                        showToast({
                                            text: "All activity logs cleared",
                                            variant: "success",
                                        })
                                    })
                                }
                            }}
                            style={{
                                padding: "8px 16px",
                                borderRadius: 20,
                                background: "rgba(218,55,60,0.08)",
                                border: `1px solid ${C.red}`,
                                color: C.red,
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                fontFamily: "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                            }}
                            className="ur-footer-btn ur-footer-btn-danger"
                        >
                            <ico.clear />
                            Clear All Logs
                        </button>
                    </div>

                    <button
                        onClick={modalProps.onClose}
                        className="ur-footer-btn ur-footer-btn-primary"
                        style={{
                            borderRadius: 20, height: 32, padding: "0 18px",
                            background: "rgba(255,255,255,0.045)", color: C.text,
                            border: `1px solid ${C.border}`, fontSize: 13,
                            fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                        }}
                    >
                        close
                    </button>
                </div>
            }
        >
            <div className="ur-modal-in">
                <div style={{ padding: "0 16px" }}>
                    <AddUserSection onAdded={refresh} />

                    <div style={{ height: 1, background: C.border, margin: "18px 0" }} />

                    <GlobalPresetControl refresh={refresh} />

                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ flex: 1, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader }}>
                            watchlist <span style={{ fontWeight: 500, color: C.muted }}>({users.length})</span>
                        </div>

                        <div role="button" tabIndex={0}
                            className="ur-chip"
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
                            <div className="ur-float" style={{ display: "flex", justifyContent: "center", marginBottom: 14, color: C.muted }}><ico.ghost /></div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: C.header }}>nobody here yet</div>
                            <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>add someone above to start tracking them</div>
                        </div>
                    )}

                    {shown.length === 0 && users.length > 0 && (
                        <div className="ur-fade-in" style={{ textAlign: "center", padding: "32px 0", fontSize: 13, color: C.muted }}>
                            no results for "<b>{query}</b>"
                        </div>
                    )}

                    {shown.map((u, i) => (
                        <WatchedRow
                            key={u.id}
                            user={u}
                            index={i}
                            refresh={refresh}
                            expandedId={expandedId}
                            setExpandedId={setExpandedId}
                            onRemove={() => {
                                removeUser(settings, u.id)
                                purgeUserCaches(u.id)
                                if (settings.store.autoCleanupLogs) activityStore.clearLogs(u.id)
                                if (getPinned().includes(u.id)) onTogglePin(u.id)
                                refresh()
                            }}
                            isPinned={pinned.includes(u.id)}
                            onTogglePin={() => onTogglePin(u.id)}
                        />
                    ))}
                </div>
            </div>
        </Modal>
    )
}

// context menu patches
