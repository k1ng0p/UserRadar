import { React, showToast } from "@webpack/common"

import { activityStore, ActivityType, onActivityRemove, onActivityUpdate } from "../activityStore"
import { ico } from "./icons"
import { ACTIVITY_CATEGORIES, matchesCategory } from "./LogCard"
import { C } from "./theme"

export function ActivityLogFooter({ userId, onRefresh }: { userId: string; onRefresh?: () => void }) {
    const [count, setCount] = React.useState(0)
    const [exportCat, setExportCat] = React.useState<ActivityType | "all">("all")

    React.useEffect(() => {
        const load = async () => {
            await activityStore.load()
            setCount(activityStore.getLogs(userId).length)
        }
        load()
        const unsub = onActivityUpdate((uid) => {
            if (uid === userId) setCount(activityStore.getLogs(userId).length)
        })
        const unsubRemove = onActivityRemove((uid) => {
            if (uid === userId) setCount(activityStore.getLogs(userId).length)
        })
        return () => { unsub(); unsubRemove() }
    }, [userId])

    return (
        <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
            width: "100%",
        }}>
            <span style={{ fontSize: 11, color: C.muted, marginRight: "auto" }}>
                {count} total events logged
            </span>
            <button
                className="ur-tab-btn ur-chip"
                onClick={() => {
                    const input = document.createElement("input")
                    input.type = "file"
                    input.accept = ".json"
                    input.onchange = async (e: any) => {
                        const file = e.target.files[0]
                        if (!file) return
                        try {
                            const text = await file.text()
                            const ok = await activityStore.importAll(text)
                            if (ok) {
                                onRefresh?.()
                                showToast({
                                    text: `Imported activity log`,
                                    variant: "success",
                                })
                            } else {
                                showToast({
                                    text: "Failed to import — invalid JSON file",
                                    variant: "critical",
                                })
                            }
                        } catch (err: any) {
                            showToast({
                                text: `Import failed: ${err?.message || "could not read file"}`,
                                variant: "critical",
                            })
                        }
                    }
                    input.click()
                }}
                style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    background: C.bg1,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = C.bg2 }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg1 }}
            >
                <ico.download />
                Import
            </button>
            <select
                className="ur-tab-btn"
                value={exportCat}
                onChange={(e) => setExportCat(e.target.value as ActivityType | "all")}
                style={{
                    padding: "0 10px",
                    height: 34,
                    borderRadius: 20,
                    background: C.bg1,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    outline: "none",
                }}
                title="what to export"
            >
                <option value="all">All categories</option>
                {ACTIVITY_CATEGORIES.map(cat => (
                    <option key={cat.key} value={cat.key}>{cat.label} only</option>
                ))}
            </select>
            <button
                className="ur-tab-btn ur-chip"
                onClick={() => {
                    const userLogs = activityStore.getLogs(userId)
                    const scoped = exportCat === "all" ? userLogs : userLogs.filter(l => matchesCategory(l, exportCat))
                    if (scoped.length === 0) {
                        showToast({
                            text: exportCat === "all" ? "No activity to export" : `No ${exportCat} logs to export`,
                            variant: "critical",
                        })
                        return
                    }
                    const data = JSON.stringify({ [userId]: scoped }, null, 2)
                    const blob = new Blob([data], { type: "application/json" })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    const suffix = exportCat === "all" ? "" : `_${exportCat}`
                    a.href = url
                    a.download = `userradar_${userId}${suffix}_${new Date().toISOString().slice(0,10)}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    showToast({
                        text: `Exported ${scoped.length} ${exportCat === "all" ? "events" : exportCat + " events"}`,
                        variant: "success",
                    })
                }}
                style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    background: C.bg1,
                    border: `1px solid ${C.border}`,
                    color: C.text,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.background = C.bg2 }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.bg1 }}
            >
                <ico.upload />
                Export
            </button>
            <button
                className="ur-tab-btn ur-chip"
                onClick={async () => {
                    if (count === 0) {
                        showToast({
                            text: "No activity to clear",
                            variant: "critical",
                        })
                        return
                    }
                    if (confirm("Clear all history for this user? This cannot be undone.")) {
                        await activityStore.clearLogs(userId)
                        onRefresh?.()
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
                    transition: "all 150ms ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(218,55,60,0.15)" }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(218,55,60,0.08)" }}
            >
                <ico.clear />
                Clear
            </button>
        </div>
    )
}

export function ActivityBadge({ userId }: { userId: string }) {
    const [count, setCount] = React.useState(0)
    const [loaded, setLoaded] = React.useState(false)

    React.useEffect(() => {
        let mounted = true
        const load = async () => {
            await activityStore.load()
            if (mounted) {
                setCount(activityStore.getLogs(userId).length)
                setLoaded(true)
            }
        }
        load()
        const unsub = onActivityUpdate((uid) => {
            if (uid === userId && mounted) {
                setCount(activityStore.getLogs(userId).length)
            }
        })
        const unsubRemove = onActivityRemove((uid) => {
            if (uid === userId && mounted) {
                setCount(activityStore.getLogs(userId).length)
            }
        })
        return () => { mounted = false; unsub(); unsubRemove() }
    }, [userId])

    return (
        <span style={{
            fontSize: 10,
            fontWeight: 800,
            background: count > 0 ? C.brand : loaded ? C.bg3 : C.bg1,
            padding: "2px 6px",
            borderRadius: 6,
            color: count > 0 ? C.white : loaded ? C.muted : "transparent",
            minWidth: 18,
            textAlign: "center",
            lineHeight: 1,
            transition: "all 150ms ease",
        }}>
            {loaded ? count : ""}
        </span>
    )
}
