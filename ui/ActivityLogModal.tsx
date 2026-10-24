import { Modal, openModal, UserStore } from "@webpack/common"

import { displayName } from "../store"
import { avatarUrl } from "../utils"
import { ActivityLogFooter } from "./ActivityLogFooter"
import { UserRadarActivityTab } from "./ActivityTab"
import { C } from "./theme"

// same size and padding as the watchlist window
export function openActivityLog(userId: string) {
    const u = UserStore.getUser(userId)
    const name = displayName(u) || userId
    const av = avatarUrl(userId, (u as any)?.avatar, 64)

    openModal(p => (
        <Modal
            {...p}
            size="xl"
            title={
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
                    <img src={av} style={{ width: 36, height: 36, borderRadius: "50%" }} />
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: C.header }}>{name}</div>
                        <div style={{ fontSize: 12, color: C.muted }}>Activity Log</div>
                    </div>
                </div>
            }
            preview={<ActivityLogFooter userId={userId} />}
        >
            <div className="ur-modal-in" style={{ padding: "0 16px" }}>
                <UserRadarActivityTab userId={userId} />
            </div>
        </Modal>
    ))
}
