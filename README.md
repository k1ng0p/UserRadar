# 👁 UserRadar

**A [Vencord](https://vencord.dev) plugin that notifies you whenever someone on your watchlist does anything on Discord.**

Messages, edits, deletes, typing, profile changes, voice activity, status changes — all tracked, all sent as real OS notifications (Windows notification center, macOS banners, etc.), not just Discord in-app toasts.

Made by **Mubashir**

---

## Features

### 🔔 Real OS Notifications
Uses the native `Notification` API so alerts actually show up in your Windows notification center / macOS notification banner even when Discord is minimized or in the background. Clicking a notification focuses Discord and jumps straight to the relevant message or channel.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496627464934396045/image.png?ex=69eb3b31&is=69e9e9b1&hm=8afe6009e4707090c44ba47b30212ffeaf6ab341c1d311ce3471eebaa7b2cb7b&)

### 📋 What Gets Tracked

| Event | Notes |
|---|---|
| **Sent message** | Fires on new messages, including server join messages |
| **Edited message** | Catches any message edit |
| **Deleted message** | Requires `vc-message-logger-enhanced` for reliable tracking |
| **Started typing** | Fires when they start typing in any channel |
| **Profile change** | Avatar, display name, username, bio, banner, accent color — all diffed |
| **Voice channel** | Join, leave, and channel switches |
| **Status change** | Online → idle → dnd → offline transitions (off by default, can be noisy) |
| **Thread created** | When a watched user creates a new thread |

### 🏷 Per-User Labels
Assign a private nickname to anyone on your watchlist — "my ex", "coworker jake", whatever. Shows up in every notification instead of their Discord name. Completely invisible to them.

### ⚙️ Per-User Overrides
Expand any user in the watchlist manager and toggle individual event types just for that person. For example: get typing notifications from one specific person globally off, but still on for one specific person. Overrides are marked with a small dot on their avatar so you know who has custom settings.

### 🔍 ID-Based User Lookup
Add users by pasting their Discord ID — no right-clicking required. The plugin fetches their profile and shows a preview card (avatar, display name, bio, banner) so you can confirm it's the right person before adding.

### 🌙 Quiet Hours
Set a time window where all notifications are suppressed. Supports overnight ranges (e.g. 23:00 to 07:00). Nothing fires during that window, even if events happen.

### 🔄 Background Profile Polling
Discord doesn't push bio/banner/accent color changes over WebSocket, so the plugin polls every watched user's profile every 5 minutes to catch those. Username and avatar changes are detected instantly via `USER_UPDATE`.

---

## Installation

> **Requires Vencord installed from source.** Won't work with the pre-built installer version since that doesn't support custom plugins.

### Steps

1. Clone or download this repo

2. Drop the `UserRadar` folder into your Vencord source's `src/userplugins/` directory:

```
Vencord/
└── src/
    └── userplugins/
        └── UserRadar/        ← goes here
            ├── index.tsx
            ├── WatchlistModal.tsx
            ├── store.ts
            └── types.ts
```

3. Build Vencord:
```sh
pnpm build
```

4. Reload Discord (or re-inject if using the injector)

5. Go to **Settings → Vencord → Plugins**, find **UserRadar**, and enable it

---

## Adding Users

**From the plugin settings:**
Settings → Vencord → Plugins → UserRadar (gear icon) → Open Watchlist Manager → switch to "Add User" tab → paste a Discord user ID → Look Up → confirm

**To find someone's Discord ID:**
Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any user and hit **Copy User ID**

> The right-click context menu option was intentionally removed since Discord updates break it constantly.

---

## Optional: Delete Tracking

Deleted message notifications only work reliably if you also have [vc-message-logger-enhanced](https://github.com/Syncxv/vc-message-logger-enhanced) installed. Without it, the plugin can only notify about deletes if Discord still has the message in its local cache — which it often purges quickly.

Install it the same way as UserRadar (drop into `userplugins`, rebuild).

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| Messages | ✅ On | Notify when a watched user sends a message |
| Edits | ✅ On | Notify on message edits |
| Deletes | ✅ On | Notify on deletes (needs logger plugin for reliability) |
| Typing | ✅ On | Notify when they start typing |
| Profile | ✅ On | Notify on profile changes (avatar, bio, banner, etc.) |
| Voice | ✅ On | Notify on voice join / leave / move |
| Status | ❌ Off | Notify on status changes — can get noisy, disabled by default |
| Show message preview | ✅ On | Include message content in notifications |
| Preview length | 120 | Max characters shown in message preview. 0 = no limit |
| Quiet hours | ❌ Off | Suppress all notifications during a set window |
| Quiet start | 23:00 | When quiet hours begin (24h format) |
| Quiet end | 07:00 | When quiet hours end (24h format) |
| Skip current channel | ✅ On | No notification if you're already in the same channel |
| Debug log | ❌ Off | Log all tracked events to the browser console |

---

## Notes

- **Profile polling** runs every 5 minutes in the background. This is intentional — Discord simply doesn't push bio/banner changes over WebSocket so there's no way around it. The poll staggers requests 1.5 seconds apart to avoid rate limiting.

- **Status tracking** is off by default because it fires a lot — anyone who goes idle and back online every hour will spam you. Turn it on per-user via overrides if you only need it for specific people.

- **Quiet hours** support overnight ranges. Setting 23:00 → 07:00 correctly suppresses notifications across midnight.

- The watchlist is stored as JSON in Vencord's settings. Don't edit the raw `watchlist` field manually.

---

## License

Do whatever you want with it. MIT or whatever, idc.
