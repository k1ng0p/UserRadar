import { openModal } from "@webpack/common"

import { WatchlistModal } from "../ui/WatchlistModal"

export function createToolbarButton() {
    const btn = document.createElement("div")
    btn.id = "ur-toolbar-btn"
    btn.setAttribute("role", "button")
    btn.setAttribute("tabindex", "0")
    btn.setAttribute("aria-label", "UserRadar Watchlist")
    btn.title = "UserRadar Watchlist"
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`
    btn.style.cssText = "display:flex;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;color:#b5bac1;margin:0 2px;border-radius:4px;transition:color 150ms ease,background 150ms ease;"
    btn.onclick = () => openModal(p => <WatchlistModal modalProps={p} />)
    btn.onmouseenter = () => { btn.style.color = "#ffffff"; btn.style.background = "rgba(255,255,255,0.1)" }
    btn.onmouseleave = () => { btn.style.color = "#b5bac1"; btn.style.background = "transparent" }
    return btn
}

let __urToolbarTimer: ReturnType<typeof setInterval> | null = null
let toolbarObserver: MutationObserver | null = null
let toolbarFrame = 0

export function injectToolbarButton() {
    if (document.getElementById("ur-toolbar-btn")) return true
    const toolbar = document.querySelector('[class^="toolbar"], [class*="toolbar_"]') as HTMLElement
    if (!toolbar) return false
    const btn = createToolbarButton()
    const firstChild = toolbar.firstElementChild
    if (firstChild) {
        toolbar.insertBefore(btn, firstChild)
    } else {
        toolbar.appendChild(btn)
    }
    return true
}

export function startToolbarObserver() {
    let attempts = 0
    const tryInject = () => {
        if (injectToolbarButton() || attempts++ > 30) {
            if (__urToolbarTimer) {
                clearInterval(__urToolbarTimer)
                __urToolbarTimer = null
            }
        }
    }
    tryInject()
    __urToolbarTimer = setInterval(tryInject, 500)
    toolbarObserver = new MutationObserver(() => {
        if (toolbarFrame) return
        toolbarFrame = requestAnimationFrame(() => {
            toolbarFrame = 0
            if (!document.getElementById("ur-toolbar-btn")) injectToolbarButton()
        })
    })
    toolbarObserver.observe(document.body, { childList: true, subtree: true })
}

export function stopToolbarObserver() {
    if (__urToolbarTimer) {
        clearInterval(__urToolbarTimer)
        __urToolbarTimer = null
    }
    toolbarObserver?.disconnect()
    toolbarObserver = null
    if (toolbarFrame) { cancelAnimationFrame(toolbarFrame); toolbarFrame = 0 }
    const btn = document.getElementById("ur-toolbar-btn")
    if (btn) btn.remove()
}
