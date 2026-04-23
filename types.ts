// discord's types package is like 2 years behind so i'm just writing what i need

export type Status = "online" | "idle" | "dnd" | "offline" | "invisible"

export interface MsgCreateEvent {
    type: string
    guildId: string
    channelId: string
    optimistic: boolean
    message: {
        id: string
        type: number
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
        author: { id: string; username: string; global_name?: string }
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
    }[]
}

export interface PresenceEvent {
    updates: {
        user: { id: string }
        status: Status
    }[]
}

// this comes back from /users/:id/profile
// also reused after camelizing USER_UPDATE payloads
export interface ProfileFetchEvent {
    user: {
        id: string
        username: string
        globalName?: string
        global_name?: string
        avatar?: string
        bio?: string
        banner?: string
        banner_color?: string
        bannerColor?: string
        accent_color?: number | null
        accentColor?: number | null
    }
    [k: string]: any
}

export interface ThreadCreateEvent {
    isNewlyCreated: boolean
    channel: {
        id: string
        name: string
        guild_id: string
        parent_id: string
        owner_id: string
        ownerId?: string
    }
}

export interface WatchedUser {
    id: string
    nick: string
    addedAt: number
    // null means "use global setting", true/false overrides it
    overrides: {
        msgs: boolean | null
        edits: boolean | null
        deletes: boolean | null
        typing: boolean | null
        profile: boolean | null
        voice: boolean | null
        status: boolean | null
    }
}
