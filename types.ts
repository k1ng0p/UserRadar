// types.ts — k1ng_op
// keeping types minimal, only what i actually use

export type Status = "online" | "idle" | "dnd" | "offline" | "invisible"

export interface MsgCreateEvent {
    type: string
    guildId: string
    channelId: string
    optimistic: boolean
    message: {
        id: string
        type: number  // 0=normal, 7=join, 8=boost
        content: string
        channel_id: string
        attachments: { filename: string; url: string }[]
        author: {
            id: string
            username: string
            global_name?: string
            avatar?: string
        }
    }
}

export interface MsgUpdateEvent {
    type: string
    guildId: string
    message: {
        id: string
        content: string
        channel_id: string
        edited_timestamp: string
        attachments: { filename: string }[]
        author: {
            id: string
            username: string
            global_name?: string
        }
    }
}

export interface MsgDeleteEvent {
    id: string
    channelId: string
    guildId: string
}

export interface TypingEvent {
    channelId: string
    userId: string
}

export interface VoiceStateEvent {
    voiceStates: {
        userId: string
        channelId: string | null
        guildId: string
        selfVideo?: boolean    // camera on
        selfStream?: boolean   // screen share (Go Live)
        selfDeaf?: boolean
        selfMute?: boolean
    }[]
}

export interface PresenceEvent {
    updates: {
        user: { id: string }
        status: Status
        client_status?: {
            desktop?: string
            mobile?: string
            web?: string
        }
        activities: {
            type: number   // 0=playing 2=listening 3=watching 4=custom 5=competing
            name: string
            details?: string
            state?: string
        }[]
    }[]
}

export interface ProfileFetchEvent {
    user: {
        id: string
        username: string
        global_name?: string
        globalName?: string   // camelized version
        avatar?: string
        bio?: string
        banner?: string
        banner_color?: string
        accent_color?: number | null
        accentColor?: number | null  // camelized
    }
    [k: string]: any
}

export interface GuildMemberEvent {
    guildId: string
    user: {
        id: string
        username: string
        global_name?: string
        avatar?: string
    }
}

// one person on the watchlist
export interface WatchedUser {
    id: string
    nick: string     // your personal label, e.g. "my ex", "the rat from work"
    addedAt: number  // timestamp so we can show when they were added
    muted?: boolean  // no notifications for this user, logging still runs
    // per-user overrides — null means "just use the global setting"
    overrides: {
        msgs:     boolean | null
        edits:    boolean | null
        deletes:  boolean | null
        typing:   boolean | null
        profile:  boolean | null
        avatar:   boolean | null
        voice:    boolean | null
        status:   boolean | null
        activity: boolean | null
        joins:    boolean | null
    }
}
