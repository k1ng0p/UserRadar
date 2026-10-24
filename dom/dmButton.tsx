import { ChannelStore } from "@webpack/common"

import { settings } from "../settings"
import { isWatched } from "../store"
import { openActivityLog } from "../ui/ActivityLogModal"

export const HISTORY_SVG = `<svg aria-hidden="true" role="img" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`

export // the watched user whose DM is open right now, if any
function openWatchedDm(): string | null {
    const match = location.pathname.match(/\/channels\/@me\/(\d+)/)
    if (!match) return null
    const channel = ChannelStore.getChannel(match[1])
    if (!channel || channel.type !== 1) return null
    const recipientId = channel.recipients?.[0]
    return recipientId && isWatched(settings, recipientId) ? recipientId : null
}

function injectDMActivityButton() {
    const recipientId = openWatchedDm()

    // discord reuses the toolbar between chats, a leftover button would open the wrong user
    const existing = document.querySelector<HTMLElement>(".ur-dm-activity-btn")
    if (existing) {
        if (existing.dataset.uid === recipientId) return
        existing.remove()
    }
    if (!recipientId) return

    // anchor on a known toolbar button by aria-label
    const knownButtonLabels = [
        'Start Voice Call',
        'Start Video Call',
        'Add Friends to DM',
        'Show Member List',
        'Threads',
        'Notification Settings',
        'Pinned Messages',
        'Search',
        'Inbox'
    ]

    let anchorBtn: Element | null = null
    for (const label of knownButtonLabels) {
        anchorBtn = document.querySelector(`[aria-label="${label}"]`)
        if (anchorBtn) break
    }

    // fallback: any visible toolbar-looking button up top
    if (!anchorBtn) {
        const header = document.querySelector('[class*="chat_"]') || document.querySelector('[class*="chatContent_"]')
        if (header) {
            const buttons = header.querySelectorAll('[role="button"]')
            for (const btn of buttons) {
                const rect = btn.getBoundingClientRect()
                if (rect.width > 20 && rect.height > 20 && rect.top < 100) {
                    anchorBtn = btn
                    break
                }
            }
        }
    }

    if (!anchorBtn) return

    const toolbar = anchorBtn.parentElement
    if (!toolbar) return
    if (toolbar.querySelector('.ur-dm-activity-btn')) return

    const btn = document.createElement('div')
    btn.className = 'ur-dm-activity-btn'
    btn.dataset.uid = recipientId
    btn.setAttribute('role', 'button')
    btn.setAttribute('tabindex', '0')
    btn.setAttribute('aria-label', 'Track User History')
    btn.title = 'Track User History'
    btn.innerHTML = HISTORY_SVG
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;cursor:pointer;color:#b5bac1;border-radius:4px;transition:color 150ms ease,background 150ms ease;flex-shrink:0;'
    btn.onmouseenter = () => { btn.style.color = '#ffffff'; btn.style.background = 'rgba(255,255,255,0.1)' }
    btn.onmouseleave = () => { btn.style.color = '#b5bac1'; btn.style.background = 'transparent' }
    btn.onclick = (e) => {
        e.stopPropagation()
        e.preventDefault()
        openActivityLog(recipientId)
    }

    // prepend so it lands on the left
    toolbar.insertBefore(btn, toolbar.firstChild)
}

let dmObserver: MutationObserver | null = null
let dmFrame = 0

export function startDMObserver() {
    injectDMActivityButton()
    // discord changes the page constantly, so check at most once per frame
    dmObserver = new MutationObserver(() => {
        if (dmFrame) return
        dmFrame = requestAnimationFrame(() => { dmFrame = 0; injectDMActivityButton() })
    })
    dmObserver.observe(document.body, { childList: true, subtree: true })
}

export function stopDMObserver() {
    dmObserver?.disconnect()
    dmObserver = null
    if (dmFrame) { cancelAnimationFrame(dmFrame); dmFrame = 0 }
    document.querySelectorAll(".ur-dm-activity-btn").forEach(el => el.remove())
}
