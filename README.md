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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496942775877505024/image.png?ex=69ebb819&is=69ea6699&hm=9c3f7226b6984ca0d555a495780038d457e10457101fdb3ba2cdfbe3dbce5248&)

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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496942400264999072/image.png?ex=69ebb7c0&is=69ea6640&hm=284c8cd877d8a9e1f91c26d96c67558e1456cb02e2395a0c44dbd2b339a9f9ac&)

### ⚙️ Per-User Overrides
Expand any user in the watchlist manager and toggle individual event types just for that person. For example: get typing notifications from one specific person globally off, but still on for one specific person. Overrides are marked with a small dot on their avatar so you know who has custom settings.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496941459754975302/image.png?ex=69ebb6df&is=69ea655f&hm=354fbb2e145d0b5e98dcbd721a1ae0e0dad0d4996f339b9ff774411dd876f179&)

### 🔍 ID-Based User Lookup
Add users by pasting their Discord ID — no right-clicking required. The plugin fetches their profile and shows a preview card (avatar, display name, bio, banner) so you can confirm it's the right person before adding.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496944566157316346/image.png?ex=69ebb9c4&is=69ea6844&hm=c233c2c47c074afb5f4b07d5fef49e5c640ad1e2fe8e817c5a7ac9f4273b78e7&)

### 🌙 Quiet Hours
Set a time window where all notifications are suppressed. Supports overnight ranges (e.g. 23:00 to 07:00). Nothing fires during that window, even if events happen.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496944047510786289/image.png?ex=69ebb948&is=69ea67c8&hm=4a05e03fa7e4b2bf4de6de2dfa1f7434c1b7b16c79fc9bbddeb306e4c0c45197&)

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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496627052726587513/image.png?ex=69eb3acf&is=69e9e94f&hm=e29344889c84ee9876c59c05b8c2fe8f9826541961c859629af8b4e2bfbfe1d4&)

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496625594518208562/image.png?ex=69eb3973&is=69e9e7f3&hm=fa88cbfdfe8c0c3ba4adca0a43b56aa75a07a430969c0a9f05f42b5d75ee159b&)

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

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496626655332925440/image.png?ex=69eb3a70&is=69e9e8f0&hm=e38e3f877c508d747879443d953ddee907bed60072563ab777469ff7cd50879f&)

---

## Notes

- **Profile polling** runs every 5 minutes in the background. This is intentional — Discord simply doesn't push bio/banner changes over WebSocket so there's no way around it. The poll staggers requests 1.5 seconds apart to avoid rate limiting.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496944908135825641/image.png?ex=69ebba15&is=69ea6895&hm=4d00d6376955d8695dc3159380b1f01293150de71281d499c6cdc323c86435e2&)

- **Status tracking** is off by default because it fires a lot — anyone who goes idle and back online every hour will spam you. Turn it on per-user via overrides if you only need it for specific people.

![Screenshot](https://cdn.discordapp.com/attachments/1216786466835791934/1496947874485899484/image.png?ex=69ebbcd9&is=69ea6b59&hm=7521de090465f18e0122414757c4009864f33c5d14411044b53bc4a48441daf7&)


- **Quiet hours** support overnight ranges. Setting 23:00 → 07:00 correctly suppresses notifications across midnight.

- The watchlist is stored as JSON in Vencord's settings. Don't edit the raw `watchlist` field manually.

---

## License

Do whatever you want with it. MIT or whatever, idc.
