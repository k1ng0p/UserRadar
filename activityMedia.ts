import { RestAPI } from "@webpack/common"

import { safeImageUrl } from "./activityStore"

// known-good public logos — only apps i can confirm resolve, no guessing broken urls
export const MUSIC_APP_ICONS: Record<string, string> = {
    "spotify":        "https://cdn.simpleicons.org/spotify/1ED760",
    "apple music":    "https://cdn.simpleicons.org/applemusic/FA243C",
    "youtube music":  "https://cdn.simpleicons.org/youtubemusic/FF0000",
    "tidal":          "https://cdn.simpleicons.org/tidal/000000",
    "deezer":         "https://cdn.simpleicons.org/deezer/FEAA2D",
    "soundcloud":     "https://cdn.simpleicons.org/soundcloud/FF5500",
    "pandora":        "https://cdn.simpleicons.org/pandora/224099",
    "qobuz":          "https://cdn.simpleicons.org/qobuz/000000",
    "last.fm":        "https://cdn.simpleicons.org/lastdotfm/D51007",
}

// one resolver for games and listening. only works when discord actually sends asset
// data though — a lot of games (minecraft's xbox rpc included) send just an appId with
// no assets, so the icon has to come from the app's own public record instead — see below
export const appIconCache: Record<string, string | null> = {}

export const _appIconFetching: Partial<Record<string, Promise<string | null>>> = {}

export async function fetchAppIcon(appId: string): Promise<string | null> {
    if (appId in appIconCache) return appIconCache[appId]
    if (_appIconFetching[appId]) return _appIconFetching[appId]
    const p = (async () => {
        try {
            const { body } = await RestAPI.get({ url: `/applications/${appId}/rpc` })
            const icon = body?.icon
            const url = icon ? `https://cdn.discordapp.com/app-icons/${appId}/${icon}.png?size=128` : null
            appIconCache[appId] = url
            return url
        } catch {
            appIconCache[appId] = null
            return null
        } finally {
            delete _appIconFetching[appId]
        }
    })()
    _appIconFetching[appId] = p
    return p
}

export function resolveActivityImage(act: any): string {
    const img = act.assets?.large_image || act.assets?.largeImage || ""
    const appId = act.application_id || act.applicationId || ""
    if (img.startsWith("spotify:")) return `https://i.scdn.co/image/${img.slice(8)}`
    if (img.startsWith("twitch:")) return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${img.slice(7)}-256x144.jpg`
    if (img.startsWith("youtube:")) return `https://i.ytimg.com/vi/${img.slice(8)}/hqdefault.jpg`
    if (img.startsWith("mp:external/")) return `https://media.discordapp.net/external/${img.slice(12)}`
    if (img.startsWith("mp:app-asset/")) return `https://media.discordapp.net/app-assets/${img.slice(13)}`
    if (img.startsWith("mp:")) return `https://media.discordapp.net/${img.slice(3)}`
    if (img.startsWith("http")) return safeImageUrl(img) ?? ""
    // some console-linked / embedded RPCs (Xbox, PlayStation, activity SDK games) send the
    // media-proxy path without discord's "mp:" scheme in front — same asset, missing prefix.
    // these got dropped straight to the controller icon before since they don't match any
    // case above and always contain a "/", tripping the old blanket "!img.includes(':')" guard.
    if (img.startsWith("external/")) return `https://media.discordapp.net/${img}`
    if (img.startsWith("app-asset/")) return `https://media.discordapp.net/${img}`
    if (appId && img && !img.includes(":")) return `https://cdn.discordapp.com/app-assets/${appId}/${img}.png`
    if (act.type === 2) return MUSIC_APP_ICONS[(act.name || "").toLowerCase()] || ""
    return ""
}

export const _albumColorCache: Record<string, string> = {}

export const ALBUM_CACHE_MAX = 300  // small hex strings, but cap it so long sessions don't grow this forever

export function extractAlbumColor(imageUrl: string): Promise<string> {
    if (_albumColorCache[imageUrl]) return Promise.resolve(_albumColorCache[imageUrl])
    return new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas")
                const ctx = canvas.getContext("2d")
                if (!ctx) { resolve("#1ed760"); return }
                const size = 64
                canvas.width = size
                canvas.height = size
                ctx.drawImage(img, 0, 0, size, size)
                const data = ctx.getImageData(0, 0, size, size).data

                const buckets: Record<string, { r: number; g: number; b: number; count: number; satSum: number }> = {}
                const bucketSize = 24 // quantize to 24-unit steps

                for (let i = 0; i < data.length; i += 8) { // sample every 2nd pixel for speed
                    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
                    if (a < 128) continue

                    const max = Math.max(r, g, b)
                    const min = Math.min(r, g, b)
                    const lum = (max + min) / 2
                    // Skip near-white, near-black, and very low saturation
                    if (lum < 35 || lum > 240) continue
                    if (max - min < 30) continue // too gray

                    const sat = max === 0 ? 0 : (max - min) / max
                    if (sat < 0.15) continue // skip low saturation

                    const br = Math.floor(r / bucketSize) * bucketSize
                    const bg = Math.floor(g / bucketSize) * bucketSize
                    const bb = Math.floor(b / bucketSize) * bucketSize
                    const key = `${br},${bg},${bb}`

                    if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, count: 0, satSum: 0 }
                    buckets[key].r += r
                    buckets[key].g += g
                    buckets[key].b += b
                    buckets[key].count++
                    buckets[key].satSum += sat
                }

                let bestKey = ""
                let bestScore = 0
                for (const key in buckets) {
                    const b = buckets[key]
                                const avgSat = b.satSum / b.count
                    const score = b.count * avgSat
                    if (score > bestScore) {
                        bestScore = score
                        bestKey = key
                    }
                }

                let hex: string
                if (bestKey && buckets[bestKey]) {
                    const b = buckets[bestKey]
                    const avgR = Math.round(b.r / b.count)
                    const avgG = Math.round(b.g / b.count)
                    const avgB = Math.round(b.b / b.count)
                    hex = `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`
                } else {
                    hex = "#1ed760"
                }

                _albumColorCache[imageUrl] = hex
                const keys = Object.keys(_albumColorCache)
                if (keys.length > ALBUM_CACHE_MAX) delete _albumColorCache[keys[0]]
                resolve(hex)
            } catch {
                resolve("#1ed760")
            }
        }
        img.onerror = () => resolve("#1ed760")
        img.src = imageUrl
    })
}
