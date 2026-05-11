import { requireSession } from "@/lib/auth"
import { listBlockedUsers } from "@/lib/safety-store"

import { BlockedUsersClient } from "./blocked-users-client"

export default async function BlockedUsersPage() {
  const session = await requireSession("/blocked-users")
  const blockedUsers = await listBlockedUsers(session.id)

  return <BlockedUsersClient initialBlockedUsers={blockedUsers} />
}
