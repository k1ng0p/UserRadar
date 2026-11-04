
export const STYLES = `
        @keyframes ur-spin { to { transform:rotate(360deg) } }
        .ur-spin { display:inline-block;width:14px;height:14px;border-radius:50%;
            border:2.5px solid #3f4147;border-top-color:#dbdee1;
            animation:ur-spin .55s linear infinite;vertical-align:middle; }
        @keyframes ur-fade-in { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
        .ur-fade-in { animation:ur-fade-in .2s cubic-bezier(.4,0,.2,1) forwards; }
        .ur-expand { display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s cubic-bezier(.4,0,.2,1); }
        .ur-expand.open { grid-template-rows:1fr; }
        .ur-expand > div { overflow:hidden; }
        .ur-row-hover:hover { background:rgba(255,255,255,0.06); }

        @keyframes ur-row-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-row { animation: ur-row-in .28s cubic-bezier(.22,1,.36,1) both; transition: transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-row:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.3); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-row:active { transform: translateY(-1px) scale(.995); }
        .ur-row.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-row-avatar { transition: transform .2s cubic-bezier(.2,.8,.2,1.4); }
        .ur-row:hover .ur-row-avatar { transform: scale(1.08); }

        .ur-row-pin { transition: opacity .12s ease, color .12s ease, transform .22s cubic-bezier(.34,1.56,.64,1); }
        .ur-row:hover .ur-row-pin { transform: scale(1.12); }

        .ur-row-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-row:hover .ur-row-chevron { opacity:1; transform: scale(1.15); }
        .ur-row-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }
        .ur-row:hover .ur-row-chevron.open { transform: rotate(180deg) scale(1.15); }

        .ur-badge-in { animation: ur-badge-in .25s cubic-bezier(.34,1.56,.64,1) both; transition: transform .18s cubic-bezier(.2,.8,.2,1.3); }
        .ur-row:hover .ur-badge-in { transform: scale(1.07); }

        .ur-activity-btn { transition: transform .22s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .22s ease; }
        .ur-activity-btn:hover { transform: translateY(-2px) scale(1.06); background: rgba(88,101,242,0.18) !important; border-color: rgba(88,101,242,0.5) !important; box-shadow: 0 6px 16px rgba(88,101,242,0.28); }
        .ur-activity-btn:active { transform: translateY(0) scale(.95); }

        @keyframes ur-pin-pop { 0% { transform:scale(.6) rotate(-20deg); } 60% { transform:scale(1.25) rotate(6deg); } 100% { transform:scale(1) rotate(0); } }
        .ur-pin-pop { animation: ur-pin-pop .38s cubic-bezier(.34,1.56,.64,1) both; }

        .ur-chip { transition: transform .12s cubic-bezier(.2,.8,.2,1), background .18s ease, color .18s ease; }
        .ur-chip:active { transform: scale(.94); }

        @keyframes ur-badge-in { from { opacity:0; transform:scale(.5); } to { opacity:1; transform:scale(1); } }
    
        .ur-icon-btn { transition: transform .14s cubic-bezier(.2,.8,.2,1.3), background .14s ease, color .14s ease; }
        .ur-icon-btn:hover { transform: translateY(-1px) scale(1.08); }
        .ur-icon-btn:active { transform: scale(.9); }

        @keyframes ur-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        .ur-float { animation: ur-float 3s ease-in-out infinite; }

        /* Discord-style thin scrollbar - only visible on hover */
        .ur-scrollbar::-webkit-scrollbar { width:4px; height:4px; }
        .ur-scrollbar::-webkit-scrollbar-track { background:transparent; }
        .ur-scrollbar::-webkit-scrollbar-thumb { background:transparent; border-radius:4px; }
        .ur-scrollbar:hover::-webkit-scrollbar-thumb { background:#3f4147; }
        .ur-scrollbar::-webkit-scrollbar-thumb:hover { background:#4a4a6e; }

        /* Firefox scrollbar */
        .ur-scrollbar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
        .ur-scrollbar:hover { scrollbar-color: #3f4147 transparent; }

        .ur-typing-dot { animation: ur-typing 1.4s infinite ease-in-out both; }
        .ur-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ur-typing-dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes ur-typing { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        @keyframes ur-shake { 0%, 100% { transform: translateX(0); } 10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); } 20%, 40%, 60%, 80% { transform: translateX(4px); } }
        .ur-shake { animation: ur-shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes ur-pulse { 0% { box-shadow: 0 0 0 0 #5865f2; } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
        .ur-pulse { animation: ur-pulse 2s infinite; }
        @keyframes ur-flash-green { 0% { background: #248046; } 100% { background: #5865f2; } }
        .ur-flash-green { animation: ur-flash-green 0.5s ease; }
        @keyframes ur-blink-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.25; transform: scale(0.7); } }
        .ur-blink-dot { animation: ur-blink-dot 1.4s ease-in-out infinite; }

        .ur-compact [data-ur-card-body] { padding: 6px 10px !important; gap: 8px !important; margin-bottom: 3px !important; min-height: 0 !important; border-radius: 10px !important; }
        .ur-compact [data-ur-card-icon] { width: 22px !important; height: 22px !important; border-radius: 6px !important; font-size: 12px !important; margin-top: 0 !important; }
        .ur-compact [data-ur-card-icon] img { width: 14px !important; height: 14px !important; }
        .ur-compact [data-ur-card-title] { font-size: 12px !important; margin-bottom: 0 !important; gap: 5px !important; }
        .ur-compact [data-ur-card-body-text="meta"] { display: none !important; }
        .ur-compact [data-ur-card-body-text="content"] { font-size: 11px !important; margin-top: 0 !important; -webkit-line-clamp: 1; display: -webkit-box !important; -webkit-box-orient: vertical; overflow: hidden; }
        .ur-compact [data-ur-card-location] { display: none !important; }
        .ur-compact [data-ur-card-live] { padding: 1px 5px !important; font-size: 8px !important; margin-bottom: 0 !important; }
        .ur-compact { gap: 4px !important; }
        .ur-compact [data-ur-day-header] { margin-bottom: 3px !important; }



        .ur-tab-btn { transition: transform 160ms cubic-bezier(.34,1.56,.64,1), background 200ms ease, color 200ms ease, box-shadow 200ms ease; }
        .ur-tab-btn:hover { transform: translateY(-1px) scale(1.03); }
        .ur-tab-btn:active { transform: scale(.95); }

        .ur-preset-card { transition: transform 200ms cubic-bezier(.34,1.56,.64,1), background 220ms ease, border-color 220ms ease, box-shadow 220ms ease; }
        .ur-preset-card:hover { transform: translateY(-2px) scale(1.015); }
        .ur-preset-card:active { transform: translateY(0) scale(.985); }

        @keyframes ur-modal-in { from { opacity:0; transform:scale(.97) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
        .ur-modal-in { animation: ur-modal-in .28s cubic-bezier(.2,.9,.3,1.1) both; }

        @keyframes ur-status-pop { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:scale(1); } }
        .ur-status-dot { animation: ur-status-pop .3s cubic-bezier(.34,1.56,.64,1) both; transition: background 200ms ease, box-shadow 200ms ease; }

        .ur-card-hover { transition: transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, border-color 180ms ease, background 180ms ease; }
        .ur-card-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }

        @keyframes ur-log-in { from { opacity:0; transform:translateY(6px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ur-log-card { animation: ur-log-in .26s cubic-bezier(.22,1,.36,1) both; transition: transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s ease, background .2s ease, border-color .18s ease; }
        .ur-log-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.3); border-color: #3f4147; background: linear-gradient(135deg, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0.1) 100%) !important; }
        .ur-log-card:active { transform: translateY(-1px) scale(.995); }
        .ur-log-card.open { box-shadow: 0 8px 22px rgba(0,0,0,0.3); }

        .ur-log-icon { transition: transform .22s cubic-bezier(.2,.8,.2,1.4), box-shadow .22s ease; }
        .ur-log-card:hover .ur-log-icon { transform: scale(1.08) rotate(-4deg); }

        .ur-log-chevron { display:flex; align-items:center; justify-content:center; color:#949ba4; flex-shrink:0; opacity:.55; transition: transform .28s cubic-bezier(.4,0,.2,1), opacity .18s ease, color .18s ease; }
        .ur-log-card:hover .ur-log-chevron { opacity:1; }
        .ur-log-chevron.open { transform: rotate(180deg); opacity:1; color:#949cf4; }

        .ur-log-expand-in { animation: ur-fade-in .22s cubic-bezier(.4,0,.2,1) both; }

        .ur-footer-btn { transition: transform .2s cubic-bezier(.34,1.56,.64,1), background .18s ease, border-color .18s ease, box-shadow .2s ease, color .18s ease; }
        .ur-footer-btn:hover { transform: translateY(-2px) scale(1.04); background: rgba(255,255,255,0.09) !important; border-color: #3f4147 !important; box-shadow: 0 6px 16px rgba(0,0,0,0.3); }
        .ur-footer-btn:active { transform: translateY(0) scale(.94); }
        .ur-footer-btn-danger:hover { background: rgba(218,55,60,0.2) !important; border-color: #da373c !important; box-shadow: 0 6px 16px rgba(218,55,60,0.3); }
        .ur-footer-btn-primary:hover { background: #5865f2 !important; border-color: #5865f2 !important; color: #fff !important; box-shadow: 0 6px 18px rgba(88,101,242,0.4); }

        /* only the first cards animate in, long lists mount instantly */
        .ur-log-card:nth-child(n+14), .ur-row:nth-child(n+12) { animation: none; }
        .ur-log-card:nth-child(2) { animation-delay: 0ms; }
        .ur-log-card:nth-child(3) { animation-delay: 22ms; }
        .ur-log-card:nth-child(4) { animation-delay: 44ms; }
        .ur-log-card:nth-child(5) { animation-delay: 66ms; }
        .ur-log-card:nth-child(6) { animation-delay: 88ms; }
        .ur-log-card:nth-child(7) { animation-delay: 110ms; }
        .ur-log-card:nth-child(8) { animation-delay: 132ms; }
        .ur-log-card:nth-child(9) { animation-delay: 154ms; }
        .ur-log-card:nth-child(10) { animation-delay: 176ms; }
        .ur-log-card:nth-child(11) { animation-delay: 198ms; }
        .ur-log-card:nth-child(12) { animation-delay: 220ms; }
        .ur-log-card:nth-child(13) { animation-delay: 242ms; }

        .ur-scrollbar { overscroll-behavior: contain; }

        .ur-row-hover:focus-visible, .ur-log-card:focus-visible, .ur-chip:focus-visible, .ur-icon-btn:focus-visible,
        .ur-footer-btn:focus-visible, .ur-activity-btn:focus-visible, .ur-tab-btn:focus-visible { outline: 2px solid #5865f2; outline-offset: 2px; }

        @media (prefers-reduced-motion: reduce) {
            .ur-row, .ur-log-card, .ur-modal-in, .ur-fade-in, .ur-badge-in, .ur-status-dot, .ur-log-expand-in, .ur-pin-pop { animation: none !important; }
            .ur-row, .ur-log-card, .ur-row-avatar, .ur-log-icon, .ur-activity-btn, .ur-footer-btn, .ur-tab-btn, .ur-preset-card, .ur-card-hover { transition: none !important; }
        }
    `

export const STYLE_ID = "ur-s9"

export function injectStyles() {
    if (document.getElementById(STYLE_ID)) return
    const s = document.createElement("style")
    s.id = STYLE_ID
    s.textContent = STYLES
    document.head.appendChild(s)
}

export function removeStyles() {
    document.getElementById(STYLE_ID)?.remove()
}
