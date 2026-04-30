# 👁 UserRadar

**A [Vencord](https://vencord.dev) plugin that notifies you whenever someone on your watchlist does anything on Discord.**

Messages, edits, deletes, typing, profile changes, voice activity, status changes — all tracked, all sent as real OS notifications (Windows notification center, macOS banners, etc.), not just Discord in-app toasts.

Made by **Mubashir**

---

⚠️ **Known Issue:** Text and black overlay glitches are present in the current screenshot preview. A fix is planned for the next update.

---
## Features

### 🔔 Real OS Notifications
Uses the native `Notification` API so alerts actually show up in your Windows notification center / macOS notification banner even when Discord is minimized or in the background. Clicking a notification focuses Discord and jumps straight to the relevant message or channel.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496942775877505024/image.png?ex=69f4f299&is=69f3a119&hm=7e3ff9ecf03fdd19464546f6ef213e8ed7436e6f8abf1c97b384468a4133d0aa&)

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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496942400264999072/image.png?ex=69f4f240&is=69f3a0c0&hm=f458518b230e20f197d5e367bebcb29d5136a97c7e9c4129cf7d54a8cc6026c2&)

### ⚙️ Per-User Overrides
Expand any user in the watchlist manager and toggle individual event types just for that person. For example: get typing notifications from one specific person globally off, but still on for one specific person. Overrides are marked with a small dot on their avatar so you know who has custom settings.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496941459754975302/image.png?ex=69f4f15f&is=69f39fdf&hm=2a98dc8ff142e0c09a7f7015de94b5af9a0b8f3940442d4c526147cd15fcb5e3&)

### 🔍 ID-Based User Lookup
Add users by pasting their Discord ID — no right-clicking required. The plugin fetches their profile and shows a preview card (avatar, display name, bio, banner) so you can confirm it's the right person before adding.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496944566157316346/image.png?ex=69f4f444&is=69f3a2c4&hm=713ec488bc9e11b981ac9c50e0ffa604a5534053b3bfc0cc1eea4d2366a50376&)

### 🌙 Quiet Hours
Set a time window where all notifications are suppressed. Supports overnight ranges (e.g. 23:00 to 07:00). Nothing fires during that window, even if events happen.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496944047510786289/image.png?ex=69f4f3c8&is=69f3a248&hm=438d9c53ce96cf11d815dab6e773a8fe165b0eac1899edbf4fd4fc8482875bf0&)

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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496627052726587513/image.png?ex=69f51e0f&is=69f3cc8f&hm=8dd6f2659e1843fd0f61395bd865b1d5a2dc56f1dc9a054c2bf7fe7300d2b15f&)

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496625594518208562/image.png?ex=69f51cb3&is=69f3cb33&hm=806443bc4b0cbf647216c2295436525e5bc8aa5723d0a58536f414fe129c45fe&)

**To find someone's Discord ID:**
Enable Developer Mode in Discord (Settings → Advanced → Developer Mode), then right-click any user and hit **Copy User ID**


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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496626655332925440/image.png?ex=69f51db0&is=69f3cc30&hm=31b4de73deef76aa78ef5f1e454886f4076868bbb543f70ed63a32f55a5d1fd3&)

---

## Notes

- **Profile polling** runs every 5 minutes in the background. This is intentional — Discord simply doesn't push bio/banner changes over WebSocket so there's no way around it. The poll staggers requests 1.5 seconds apart to avoid rate limiting.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496944908135825641/image.png?ex=69ebba15&is=69ea6895&hm=4d00d6376955d8695dc3159380b1f01293150de71281d499c6cdc323c86435e2&)

- **Status tracking** is off by default because it fires a lot — anyone who goes idle and back online every hour will spam you. Turn it on per-user via overrides if you only need it for specific people.

![Screenshot](https://cdn.discordapp.com/attachments/1045751055595602023/1498311963430883491/bw6krq2.png?ex=69f4a7c1&is=69f35641&hm=2693dc9dcd59ef4e1abeef5c18dfffbd6c0696efbaa0e5c507a88a82d529cc19&)


- **Quiet hours** support overnight ranges. Setting 23:00 → 07:00 correctly suppresses notifications across midnight.

- The watchlist is stored as JSON in Vencord's settings. Don't edit the raw `watchlist` field manually.

---

## License

Do whatever you want with it. MIT or whatever, idc.
