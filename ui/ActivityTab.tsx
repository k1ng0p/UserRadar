import { React } from "@webpack/common"

import { ActivityEntry, activityStore, ActivityType, onActivityRemove, onActivityUpdate } from "../activityStore"
import { activeSessions } from "../sessions"
import { settings } from "../settings"
import { formatDuration } from "../utils"
import { ico } from "./icons"
import { ACTIVITY_CATEGORIES, LogCard, matchesCategory } from "./LogCard"
import { C } from "./theme"

export function UserRadarActivityTab({ userId }: { userId: string }) {
    const [logs, setLogs] = React.useState<ActivityEntry[]>([])
    const [activeFilters, setActiveFilters] = React.useState<Set<ActivityType>>(new Set())
    const [expandedId, setExpandedId] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [sortMode, setSortMode] = React.useState<"newest" | "oldest">("newest")
    const [compact, setCompact] = React.useState(() => !!settings.store.compactLogView)
    // only mount this many cards at first — rest load in on demand so opening
    // the log with hundreds of entries doesn't freeze on a big DOM dump
    const [visibleCount, setVisibleCount] = React.useState(60)
    // stable identities, otherwise LogCard's memo never skips anything
    const toggleCard = React.useCallback((id: string) => setExpandedId(cur => cur === id ? null : id), [])
    const deleteCard = React.useCallback((id: string) => setLogs(prev => prev.filter(l => l.id !== id)), [])
    React.useEffect(() => { setVisibleCount(60) }, [activeFilters, searchQuery, sortMode])

    const toggleCompact = () => {
        const next = !compact
        setCompact(next)
        settings.store.compactLogView = next
    }

    React.useEffect(() => {
        const load = async () => {
            await activityStore.load()
            setLogs(activityStore.getLogs(userId))
            setLoading(false)
        }
        load()
        const unsub = onActivityUpdate((uid, entry) => {
            if (uid !== userId) return
            setLogs(prev => {
                const existingIdx = prev.findIndex(l => l.id === entry.id)
                if (existingIdx === -1) return [entry, ...prev]
                // replace in place so a closing session doesn't duplicate
                const next = [...prev]
                next.splice(existingIdx, 1)
                return [entry, ...next]
            })
        })
        const unsubRemove = onActivityRemove((uid, logId) => {
            if (uid !== userId) return
            setLogs(prev => prev.filter(l => l.id !== logId))
        })
        return () => { unsub(); unsubRemove() }
    }, [userId])

    const toggleFilter = (key: ActivityType) => {
        setActiveFilters(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const clearFilters = () => {
        setActiveFilters(new Set())
    }

    const deleteCategory = async (cat: typeof ACTIVITY_CATEGORIES[number]) => {
        const count = logs.filter(l => matchesCategory(l, cat.key)).length
        if (count === 0) return
        if (!confirm(`Delete all ${count} ${cat.label.toLowerCase()} cards for this user? This cannot be undone.`)) return
        await activityStore.removeLogsWhere(userId, l => matchesCategory(l, cat.key))
        setLogs(prev => prev.filter(l => !matchesCategory(l, cat.key)))
        setActiveFilters(prev => {
            if (!prev.has(cat.key)) return prev
            const next = new Set(prev)
            next.delete(cat.key)
            return next
        })
    }

    const filtered = React.useMemo(() => {
        let result = logs
        if (activeFilters.size > 0) {
            result = result.filter(l => {
                for (const filter of activeFilters) {
                    if (matchesCategory(l, filter)) return true
                }
                return false
            })
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            result = result.filter(l =>
                l.title.toLowerCase().includes(q) ||
                l.body.toLowerCase().includes(q) ||
                l.type.toLowerCase().includes(q) ||
                (l.metadata?.appName && l.metadata.appName.toLowerCase().includes(q)) ||
                (l.metadata?.song && l.metadata.song.toLowerCase().includes(q)) ||
                (l.metadata?.artist && l.metadata.artist.toLowerCase().includes(q))
            )
        }
        const sorted = [...result]
        if (sortMode === "oldest") sorted.sort((a, b) => a.ts - b.ts)
        return sorted
    }, [logs, activeFilters, searchQuery, sortMode])

    const visibleFiltered = React.useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

    const grouped = React.useMemo(() => {
        return visibleFiltered.reduce((acc, log) => {
            const date = new Date(log.ts).toLocaleDateString()
            if (!acc[date]) acc[date] = []
            acc[date].push(log)
            return acc
        }, {} as Record<string, ActivityEntry[]>)
    }, [visibleFiltered])

    const categoryCounts = React.useMemo(() => {
        const counts: Record<string, number> = {}
        for (const cat of ACTIVITY_CATEGORIES) {
            counts[cat.key] = logs.filter(l => matchesCategory(l, cat.key)).length
        }
        return counts
    }, [logs])

    const todayStats = React.useMemo(() => {
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const dayStartMs = startOfDay.getTime()
        const now = Date.now()
        const todayLogs = logs.filter(l => l.ts >= dayStartMs)

        const msgCount = todayLogs.filter(l => l.type === "msg").length

        let voiceMs = 0
        for (const l of todayLogs) {
            if (l.type === "session" && typeof l.metadata?.startTime === "number" && typeof l.metadata?.endTime === "number") {
                // clamp to today in case it started yesterday
                const start = Math.max(l.metadata.startTime, dayStartMs)
                voiceMs += Math.max(0, l.metadata.endTime - start)
            }
        }
        // include ongoing session time too
        for (const s of Object.values(activeSessions)) {
            if (s.logId && todayLogs.some(l => l.id === s.logId)) {
                const start = Math.max(s.startTime, dayStartMs)
                voiceMs += Math.max(0, now - start)
            }
        }

        const statusChanges = todayLogs.filter(l => matchesCategory(l, "status")).length

        return { msgCount, voiceMs, statusChanges, total: todayLogs.length }
    }, [logs])

    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
                <div className="ur-spin" style={{ width: 24, height: 24, margin: "0 auto 12px" }} />
                <div style={{ fontSize: 13 }}>Loading activity log...</div>
            </div>
        )
    }

    return (
        <div style={{ padding: "0 4px" }}>
            {logs.length > 0 && (
                <div style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 12,
                    flexWrap: "wrap",
                }}>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.msgCount}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>messages today</div>
                    </div>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.voiceMs > 0 ? formatDuration(todayStats.voiceMs) : "0m"}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>voice today</div>
                    </div>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.statusChanges}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>status changes</div>
                    </div>
                    <div className="ur-card-hover ur-glass" style={{ flex: "1 1 auto", minWidth: 70, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "8px 10px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.header }}>{todayStats.total}</div>
                        <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>events today</div>
                    </div>
                </div>
            )}

            <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
                <div className="ur-glass" style={{ position: "relative", flex: 1, minWidth: 0, borderRadius: 20 }}>
                    <input
                        placeholder="Search activity..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            background: "rgba(255,255,255,0.04)",
                            borderRadius: 20,
                            border: `1px solid ${C.border}`,
                            height: 32,
                            boxSizing: "border-box",
                            padding: "0 32px 0 12px",
                            width: "100%",
                            fontSize: 13,
                            color: C.text,
                            outline: "none",
                            fontFamily: "inherit",
                            transition: "border-color 150ms ease, box-shadow 150ms ease",
                        }}
                        onFocus={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.boxShadow = `0 0 0 1px ${C.brand}40` }}
                        onBlur={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.boxShadow = "none" }}
                    />
                    <div style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: C.muted,
                        display: "flex",
                        alignItems: "center",
                        pointerEvents: "none",
                    }}>
                        <ico.search />
                    </div>
                </div>

                <div
                    role="button"
                    tabIndex={0}
                    className="ur-chip ur-tab-btn ur-glass"
                    onClick={() => setSortMode(s => s === "newest" ? "oldest" : "newest")}
                    style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "0 10px",
                        borderRadius: 20,
                        cursor: "pointer",
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${C.border}`,
                        color: C.muted,
                        fontSize: 11,
                        fontWeight: 600,
                        userSelect: "none",
                        height: 32,
                        boxSizing: "border-box",
                        transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                        flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.08)" }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "rgba(255,255,255,0.04)" }}
                >
                    {sortMode === "newest" ? <ico.sortDate /> : <ico.sortAz />}
                    {sortMode === "newest" ? "Newest" : "Oldest"}
                </div>

                <div
                    role="button"
                    tabIndex={0}
                    className="ur-chip ur-tab-btn ur-glass"
                    title={compact ? "switch to normal view" : "switch to compact view"}
                    onClick={toggleCompact}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 32,
                        borderRadius: 20,
                        cursor: "pointer",
                        background: compact ? `${C.brand}25` : "rgba(255,255,255,0.04)",
                        border: `1px solid ${compact ? C.brand : C.border}`,
                        color: compact ? C.brandLight : C.muted,
                        height: 32,
                        boxSizing: "border-box",
                        transition: "background 150ms ease, border-color 150ms ease, color 150ms ease",
                        flexShrink: 0,
                    }}
                    onMouseEnter={e => { if (!compact) { e.currentTarget.style.borderColor = C.bgEl; e.currentTarget.style.color = C.text; e.currentTarget.style.background = "rgba(255,255,255,0.08)" } }}
                    onMouseLeave={e => { if (!compact) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; e.currentTarget.style.background = "rgba(255,255,255,0.04)" } }}
                >
                    <ico.compact />
                </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                {ACTIVITY_CATEGORIES.map(cat => {
                    const isActive = activeFilters.has(cat.key)
                    const count = categoryCounts[cat.key] || 0
                    return (
                        <div
                            key={cat.key}
                            className="ur-chip ur-tab-btn ur-glass"
                            onClick={() => toggleFilter(cat.key)}
                            style={{
                                padding: "5px 10px",
                                borderRadius: 16,
                                background: isActive ? `${cat.color}25` : "rgba(255,255,255,0.04)",
                                color: isActive ? cat.color : C.muted,
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                transition: "background 150ms ease, color 150ms ease, border-color 150ms ease",
                                userSelect: "none",
                                border: `1px solid ${isActive ? `${cat.color}60` : C.border}`,
                                opacity: count === 0 ? 0.5 : 1,
                                flexShrink: 0,
                            }}
                            onMouseEnter={e => {
                                if (!isActive) {
                                    e.currentTarget.style.background = "rgba(255,255,255,0.09)"
                                    e.currentTarget.style.color = C.text
                                }
                            }}
                            onMouseLeave={e => {
                                if (!isActive) {
                                    e.currentTarget.style.background = "rgba(255,255,255,0.04)"
                                    e.currentTarget.style.color = C.muted
                                }
                            }}
                        >
                            {isActive && (
                                <span
                                    className="ur-blink-dot"
                                    style={{
                                        display: "inline-block",
                                        width: 5,
                                        height: 5,
                                        borderRadius: "50%",
                                        background: cat.color,
                                        flexShrink: 0,
                                    }}
                                />
                            )}
                            <span style={{ display: "flex", alignItems: "center" }}><cat.Icon /></span>
                            <span>{cat.label}</span>
                            <span style={{
                                background: isActive ? `${cat.color}40` : C.bg3,
                                padding: "1px 5px",
                                borderRadius: 6,
                                fontSize: 9,
                                fontWeight: 800,
                                color: isActive ? cat.color : C.muted,
                            }}>
                                {count}
                            </span>
                            {count > 0 && (
                                <span
                                    className="ur-chip-trash"
                                    title={`Delete all ${cat.label.toLowerCase()} cards`}
                                    onClick={e => { e.stopPropagation(); deleteCategory(cat) }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        width: 14,
                                        height: 14,
                                        marginLeft: 1,
                                        borderRadius: 4,
                                        color: C.muted,
                                        opacity: 0.55,
                                        transition: "opacity 120ms ease, color 120ms ease",
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = C.red }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.color = C.muted }}
                                >
                                    <ico.trash />
                                </span>
                            )}
                        </div>
                    )
                })}

                {activeFilters.size > 0 && (
                    <div
                        onClick={clearFilters}
                        style={{
                            padding: "5px 10px",
                            borderRadius: 12,
                            background: "transparent",
                            color: C.muted,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            transition: "all 150ms ease",
                            userSelect: "none",
                            border: `1px solid ${C.border}`,
                            flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = C.danger; e.currentTarget.style.borderColor = C.danger }}
                        onMouseLeave={e => { e.currentTarget.style.color = C.muted; e.currentTarget.style.borderColor = C.border }}
                    >
                        <ico.x />
                        Clear
                    </div>
                )}
            </div>

            <div className={compact ? "ur-compact" : ""} style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                paddingRight: 4,
            }}>
                {Object.entries(grouped).map(([date, dayLogs]) => (
                    <div key={date}>
                        <div data-ur-day-header style={{
                            fontSize: 10,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: 0.8,
                            color: C.muted,
                            marginBottom: 8,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                        }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <ico.calendar />
                                {date === new Date().toLocaleDateString() ? "Today" : date}
                            </span>
                            <span style={{ flex: 1, height: 1, background: C.border }} />
                            <span>{dayLogs.length} events</span>
                        </div>
                        {dayLogs.map(log => (
                            <LogCard
                                key={log.id}
                                log={log}
                                expanded={expandedId === log.id}
                                onToggle={toggleCard}
                                onDelete={deleteCard}
                                userId={userId}
                            />
                        ))}
                    </div>
                ))}
                {filtered.length > visibleCount && (
                    <button
                        className="ur-tab-btn ur-chip"
                        onClick={() => setVisibleCount(v => v + 60)}
                        style={{
                            alignSelf: "center",
                            marginTop: 4,
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
                        Load more · {filtered.length - visibleCount} left
                    </button>
                )}
                {logs.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
                        <div style={{
                            width: 56,
                            height: 56,
                            borderRadius: "50%",
                            background: C.bg1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            margin: "0 auto 14px",
                            border: `1px solid ${C.border}`,
                        }}>
                            <ico.ghost />
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.header }}>No activity tracked yet</div>
                        <div style={{ fontSize: 12, marginTop: 4, color: C.muted }}>Events will appear here once this user does something</div>
                    </div>
                )}
                {logs.length > 0 && filtered.length === 0 && (
                    <div style={{ textAlign: "center", padding: "32px 0", color: C.muted }}>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, opacity: 0.5 }}>
                            <ico.search />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>No matching events</div>
                        <div style={{ fontSize: 11, marginTop: 3 }}>Try adjusting your filters or search</div>
                    </div>
                )}
            </div>

                    </div>
    )
}

// activity count badge
