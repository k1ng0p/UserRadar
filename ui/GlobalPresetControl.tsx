import { settings } from "../settings"
import { C } from "./theme"

export function GlobalPresetControl({ refresh }: { refresh: () => void }) {
    const mode = settings.store.globalPresetMode || "custom"
    const presets = [
        { key: "custom",  label: "Custom",  desc: "Per-user control",         color: C.brand },
        { key: "stalker", label: "Stalker", desc: "Everything tracked",       color: C.danger },
        { key: "lite",    label: "Lite",    desc: "Essential tracking only",  color: C.brandLight },
        { key: "silent",  label: "Silent",  desc: "Log everything silently",    color: "#b5bac1" }, // lighter gray for better active contrast
    ]
    const activeIndex = presets.findIndex(p => p.key === mode)

    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: C.subheader, marginBottom: 10 }}>
                Global Preset Mode
            </div>

            <div className="ur-glass" style={{
                display: "grid",
                gridTemplateColumns: `repeat(${presets.length}, 1fr)`,
                background: "rgba(0,0,0,0.35)",
                borderRadius: 22,
                border: `1px solid ${C.border}`,
                padding: 4,
                position: "relative",
            }}>
                <div style={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    left: 4,
                    width: `calc((100% - 8px) / ${presets.length})`,
                    transform: `translateX(${activeIndex * 100}%)`,
                    background: `linear-gradient(145deg, ${presets[activeIndex].color}2a 0%, ${presets[activeIndex].color}10 100%)`,
                    border: `1.5px solid ${presets[activeIndex].color}70`,
                    borderRadius: 18,
                    boxShadow: `0 0 20px ${presets[activeIndex].color}30, inset 0 1px 0 rgba(255,255,255,0.08)`,
                    transition: "transform 320ms cubic-bezier(0.34,1.2,0.4,1), background 220ms ease, border-color 220ms ease, box-shadow 220ms ease",
                    pointerEvents: "none",
                    boxSizing: "border-box",
                    zIndex: 1,
                }} />

                {presets.map(p => {
                    const isActive = mode === p.key
                    return (
                        <div
                            key={p.key}
                            className="ur-tab-btn"
                            onClick={() => { settings.store.globalPresetMode = p.key; refresh() }}
                            style={{
                                padding: "12px 10px",
                                borderRadius: 18,
                                cursor: "pointer",
                                textAlign: "left",
                                position: "relative",
                                zIndex: 2,
                                userSelect: "none",
                            }}
                            onMouseEnter={e => {
                                if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.05)"
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = "transparent"
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color, boxShadow: isActive ? `0 0 8px ${p.color}` : "none", flexShrink: 0, transition: "box-shadow 220ms" }} />
                                <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? p.color : C.subheader, transition: "color 200ms ease", whiteSpace: "nowrap" }}>
                                    {p.label}
                                </span>
                            </div>
                            <div style={{
                                fontSize: 10,
                                color: isActive ? C.text : C.muted,
                                lineHeight: 1.3,
                                transition: "color 200ms ease",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}>
                                {p.desc}
                            </div>
                        </div>
                    )
                })}
            </div>

            {mode !== "custom" && (
                <div style={{
                    marginTop: 10,
                    padding: "10px 14px",
                    background: C.bg1,
                    borderRadius: 14,
                    border: `1px solid ${C.border}`,
                    fontSize: 12,
                    color: C.muted,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                }}>
                    <span style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: presets[activeIndex].color,
                        flexShrink: 0,
                    }} />
                    <span>
                        All users follow the <b style={{ color: presets[activeIndex].color }}>{presets[activeIndex].label}</b> preset. Individual overrides are disabled. Switch to <b style={{ color: C.brand, cursor: "pointer" }} onClick={() => { settings.store.globalPresetMode = "custom"; refresh() }}>Custom</b> to configure per-user.
                    </span>
                </div>
            )}
        </div>
    )
}
