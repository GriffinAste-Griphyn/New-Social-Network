import {
  deleteMobileApi,
  postMobileApi,
} from "@/lib/mobile-api"

export type SafetyReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "sexual_content"
  | "violence"
  | "self_harm"
  | "illegal_goods"
  | "impersonation"
  | "intellectual_property"
  | "other"

type ReportResponse = {
  ok: true
  reportId: string
}

export async function blockAccount(userId: string, reason?: string) {
  return postMobileApi<{ ok: true }>("/api/mobile/blocks", {
    userId,
    reason,
  })
}

export async function unblockAccount(userId: string) {
  return deleteMobileApi<{ ok: true }>("/api/mobile/blocks", {
    userId,
  })
}

export async function reportAccount(
  userId: string,
  reason: SafetyReportReason = "harassment",
  details?: string,
) {
  return postMobileApi<ReportResponse>("/api/mobile/reports", {
    targetKind: "user",
    targetId: userId,
    reason,
    details,
  })
}

export async function reportStory(
  storyId: string,
  reason: SafetyReportReason = "harassment",
  details?: string,
) {
  return postMobileApi<ReportResponse>("/api/mobile/reports", {
    targetKind: "story",
    targetId: storyId,
    reason,
    details,
  })
}

export async function reportInteraction(
  interactionId: string,
  reason: SafetyReportReason = "harassment",
  details?: string,
) {
  return postMobileApi<ReportResponse>("/api/mobile/reports", {
    targetKind: "interaction",
    targetId: interactionId,
    reason,
    details,
  })
}
