// Private upload time is not publication time. A durable client's Post timestamp
// may advance its reservation, but cannot backdate before lease creation or into
// the server's future. Existing clients keep the original reservation behavior.
export function videoStoryReservationTime(leaseCreatedAt: Date, draftSubmittedAt?: string, now = new Date()) {
  if (!draftSubmittedAt) return leaseCreatedAt
  const submitted = Date.parse(draftSubmittedAt)
  if (!Number.isFinite(submitted)) return leaseCreatedAt
  return new Date(Math.max(leaseCreatedAt.getTime(), Math.min(submitted, now.getTime())))
}
