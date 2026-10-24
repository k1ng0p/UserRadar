import { logActivity } from "../activityStore"
import { guildCache } from "../caches"
import { isFeatureOn, labeledName, notify } from "../notify"
import { settings } from "../settings"
import { isWatched } from "../store"
import { GuildMemberEvent } from "../types"
import { avatarUrl, guildName, jumpTo } from "../utils"

export function onGuildMemberAdd({ guildId, user }: GuildMemberEvent) {
    if (!user?.id || !isWatched(settings, user.id)) return
    if (!isFeatureOn(user.id, "joins", "globalJoins")) return

    // no baseline yet (profile fetch failed or still pending) means every event is trusted
    const known = guildCache[user.id]
    if (known?.has(guildId)) return
    known?.add(guildId)

    const gn = guildName(guildId)
    const dn = labeledName(user.id, user)
    notify({
        _uid: user.id,
        title: `${dn} Joined a Server`,
        body: gn || "a server",
        icon: avatarUrl(user.id, user.avatar, 80),
        onClick: () => jumpTo(guildId),
    })
    logActivity(user.id, "join", "📥", `joined ${gn || guildId}`, guildId)
}

export function onGuildMemberRemove({ guildId, user }: GuildMemberEvent) {
    if (!user?.id || !isWatched(settings, user.id)) return
    if (!isFeatureOn(user.id, "joins", "globalJoins")) return

    const known = guildCache[user.id]
    if (known && !known.has(guildId)) return
    known?.delete(guildId)

    const gn = guildName(guildId)
    const dn = labeledName(user.id, user)
    notify({
        _uid: user.id,
        title: `${dn} Left a Server`,
        body: gn || "a server",
        icon: avatarUrl(user.id, user.avatar, 80),
        onClick: () => jumpTo(guildId),
    })
    logActivity(user.id, "leave", "📤", `left ${gn || guildId}`, guildId)
}
