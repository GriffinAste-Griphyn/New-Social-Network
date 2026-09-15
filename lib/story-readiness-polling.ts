/** Poll quickly during normal short-clip processing; back off for long jobs. */
export function cloudflareReadinessPollDelay(input: { createdAt?: Date; now?: Date }) {
  const age = input.createdAt ? (input.now ?? new Date()).getTime() - input.createdAt.getTime() : Infinity
  if (!Number.isFinite(age) || age < 0) return 3_000
  if (age < 20_000) return 750
  if (age < 60_000) return 1_500
  return 3_000
}
