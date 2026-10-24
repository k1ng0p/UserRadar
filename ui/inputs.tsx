import { React } from "@webpack/common"

import { ico } from "./icons"
import { C } from "./theme"

export function LabelInput({ nick, setNick, saveNick }: { nick: string; setNick: (v: string) => void; saveNick: () => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <input
            placeholder="label"
            maxLength={50}
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 50))}
            onBlur={() => { setFocused(false); saveNick() }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { setFocused(false); saveNick() } }}
            style={{
                background: C.bg1,
                borderRadius: 20,
                border: `1px solid ${focused ? C.brand : C.border}`,
                boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                height: 26,
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                padding: "0 10px",
                fontSize: 12,
                width: "100%",
                margin: 0,
                color: C.text,
                outline: "none",
                transition: "border-color 150ms ease, box-shadow 150ms ease",
                fontFamily: "inherit",
            }}
        />
    )
}

export function SearchInput({ query, setQuery }: { query: string; setQuery: (v: string) => void }) {
    const [focused, setFocused] = React.useState(false)
    return (
        <div style={{ position: "relative", width: 160, flexShrink: 0 }}>
            <input
                placeholder="search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => setFocused(false)}
                onFocus={() => setFocused(true)}
                style={{
                    background: "#1e1f22",
                    borderRadius: 20,
                    border: `1px solid ${focused ? C.brand : "#3f4147"}`,
                    boxShadow: focused ? "0 0 0 3px rgba(88,101,242,0.18)" : "none",
                    height: 28,
                    boxSizing: "border-box",
                    padding: "0 28px 0 12px",
                    width: "100%",
                    fontSize: 13,
                    color: "#dbdee1",
                    outline: "none",
                    fontFamily: "inherit",
                    transition: "border-color 150ms ease, box-shadow 150ms ease",
                }}
            />
            <div style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#949ba4",
                display: query ? "none" : "flex",
                alignItems: "center",
                pointerEvents: "none",
            }}>
                <ico.search />
            </div>
            {query && (
                <div
                    role="button"
                    onClick={() => setQuery("")}
                    style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#949ba4",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        lineHeight: 1,
                    }}
                >
                    <ico.x />
                </div>
            )}
        </div>
    )
}
