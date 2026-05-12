import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

import { useAuthFlow } from "@/lib/auth-flow"
import {
  deleteMobileApi,
  getMobileApi,
  postMobileApi,
} from "@/lib/mobile-api"

type FollowStateContextValue = {
  followedCreatorIds: Set<string>
  revision: number
  isFollowing: (creatorId: string) => boolean
  removeFollowLocally: (creatorId: string) => void
  toggleFollow: (creatorId: string) => void
}

const FollowStateContext = createContext<FollowStateContextValue | null>(null)

export function FollowStateProvider({ children }: { children: ReactNode }) {
  const { account } = useAuthFlow()
  const [followedCreatorIds, setFollowedCreatorIds] = useState(
    () => new Set<string>(),
  )
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let isMounted = true

    if (!account?.mobileToken) {
      setFollowedCreatorIds(new Set())
      return
    }

    getMobileApi<{ ok: true; followedCreatorIds: string[] }>(
      "/api/mobile/follows",
      { authToken: account.mobileToken },
    )
      .then((payload) => {
        if (isMounted) {
          setFollowedCreatorIds(new Set(payload.followedCreatorIds))
          setRevision((current) => current + 1)
        }
      })
      .catch(() => undefined)

    return () => {
      isMounted = false
    }
  }, [account?.mobileToken])

  const isFollowing = useCallback(
    (creatorId: string) => followedCreatorIds.has(creatorId),
    [followedCreatorIds],
  )

  const toggleFollow = useCallback((creatorId: string) => {
    const shouldFollow = !followedCreatorIds.has(creatorId)

    setFollowedCreatorIds((current) => {
      const next = new Set(current)

      if (shouldFollow) {
        next.add(creatorId)
      } else {
        next.delete(creatorId)
      }

      return next
    })

    if (!account?.mobileToken) {
      setRevision((current) => current + 1)
      return
    }

    const request = shouldFollow
      ? postMobileApi("/api/mobile/follows", { creatorId }, { authToken: account.mobileToken })
      : deleteMobileApi("/api/mobile/follows", { creatorId }, { authToken: account.mobileToken })

    request
      .then(() => {
        setRevision((current) => current + 1)
      })
      .catch(() => {
        setFollowedCreatorIds((current) => {
          const next = new Set(current)

          if (shouldFollow) {
            next.delete(creatorId)
          } else {
            next.add(creatorId)
          }

          return next
        })
        setRevision((current) => current + 1)
      })
  }, [account?.mobileToken, followedCreatorIds])

  const removeFollowLocally = useCallback((creatorId: string) => {
    setFollowedCreatorIds((current) => {
      if (!current.has(creatorId)) {
        return current
      }

      const next = new Set(current)
      next.delete(creatorId)
      return next
    })
    setRevision((current) => current + 1)
  }, [])

  const value = useMemo(
    () => ({
      followedCreatorIds,
      revision,
      isFollowing,
      removeFollowLocally,
      toggleFollow,
    }),
    [
      followedCreatorIds,
      isFollowing,
      removeFollowLocally,
      revision,
      toggleFollow,
    ],
  )

  return (
    <FollowStateContext.Provider value={value}>
      {children}
    </FollowStateContext.Provider>
  )
}

export function useFollowState() {
  const context = useContext(FollowStateContext)

  if (!context) {
    throw new Error("useFollowState must be used inside FollowStateProvider")
  }

  return context
}
