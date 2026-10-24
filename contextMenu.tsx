import { NavContextMenuPatchCallback } from "@api/ContextMenu"
import { Menu, openModal, showToast } from "@webpack/common"

import { purgeUserCaches } from "./caches"
import { fetchNewUserBaseline } from "./handlers/profile"
import { settings } from "./settings"
import { addUser, displayName, isWatched, removeUser } from "./store"
import { CtxEyeIcon, CtxEyeOffIcon, CtxGearIcon } from "./ui/icons"
import { WatchlistModal } from "./ui/WatchlistModal"

export const userCtxPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user) return
    const isW = isWatched(settings, user.id)
    const idx = children.findIndex(c => c?.props?.id === "user-context-devmode-copy-id")
    children.splice(idx >= 0 ? idx + 1 : children.length, 0,
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="ur-watch"
                label={isW ? "Unwatch User" : "Watch User"}
                icon={isW ? CtxEyeOffIcon : CtxEyeIcon}
                action={() => {
                    if (isW) { removeUser(settings, user.id); purgeUserCaches(user.id); showToast({ text: `removed ${displayName(user)} from watchlist` }) }
                    else { addUser(settings, user.id); fetchNewUserBaseline(user.id); showToast({ variant: "success", text: `added ${displayName(user)} to watchlist` }) }
                }}

            />
            <Menu.MenuItem
                id="ur-config"
                label="Manage Watchlist"
                icon={CtxGearIcon}
                action={() => openModal(p => <WatchlistModal modalProps={p} />)}

            />
        </Menu.MenuGroup>
    )
}

export const msgCtxPatch: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message?.author) return
    const isW = isWatched(settings, message.author.id)
    const idx = children.findIndex(c => c?.props?.id === "message-devmode-copy-id")
    children.splice(idx >= 0 ? idx + 1 : children.length, 0,
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="ur-msg-watch"
                label={isW ? "remove author from watchlist" : "add author to watchlist"}
                icon={isW ? CtxEyeOffIcon : CtxEyeIcon}
                action={() => {
                    if (isW) { removeUser(settings, message.author.id); purgeUserCaches(message.author.id); showToast({ text: `removed ${displayName(message.author)} from watchlist` }) }
                    else { addUser(settings, message.author.id); fetchNewUserBaseline(message.author.id); showToast({ variant: "success", text: `added ${displayName(message.author)} to watchlist` }) }
                }}

            />
        </Menu.MenuGroup>
    )
}

// the plugin itself

// DM toolbar — injects clock icon for tracked users
