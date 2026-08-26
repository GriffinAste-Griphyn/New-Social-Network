import { NextResponse } from "next/server"
import { z } from "zod"

import { getCompleteMobileSession } from "@/lib/auth"
import {
  mobilePerformanceEventNames,
  recordMobilePerformanceEvents,
} from "@/lib/mobile-performance-events"
import {
  enforceRequestRateLimits,
  mutationRateLimits,
  requestIpSubject,
} from "@/lib/request-security"

export const runtime = "nodejs"

const metadataValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
])

const performanceEventSchema = z.object({
  name: z.enum(mobilePerformanceEventNames),
  durationMs: z.number().int().min(0).max(10 * 60 * 1000).nullable().optional(),
  metadata: z.record(z.string().min(1).max(40), metadataValueSchema).optional(),
  clientCreatedAt: z.coerce.date().optional(),
})

const performanceEventsSchema = z.object({
  events: z.array(performanceEventSchema).min(1).max(50),
})

function trimMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
) {
  if (!metadata) {
    return {}
  }

  return Object.fromEntries(Object.entries(metadata).slice(0, 20))
}

export async function POST(request: Request) {
  const session = await getCompleteMobileSession(request)

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const rateLimitResponse = await enforceRequestRateLimits(request, [
    {
      bucket: "mobile:performance-events:user",
      subject: session.id,
      options: mutationRateLimits.mobileTelemetryUser,
    },
    {
      bucket: "mobile:performance-events:ip",
      subject: requestIpSubject(request),
      options: mutationRateLimits.mobileTelemetryUser,
    },
  ])
  if (rateLimitResponse) {
    return rateLimitResponse
  }

  const parsed = performanceEventsSchema.safeParse(
    await request.json().catch(() => null),
  )

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Could not record performance events." },
      { status: 400 },
    )
  }

  const result = await recordMobilePerformanceEvents({
    userId: session.id,
    events: parsed.data.events.map((event) => ({
      name: event.name,
      durationMs: event.durationMs ?? null,
      metadata: trimMetadata(event.metadata),
      clientCreatedAt: event.clientCreatedAt ?? null,
    })),
  })

  console.info("mobile_performance_events_recorded", {
    userId: session.id,
    received: parsed.data.events.length,
    accepted: result.accepted,
    names: Array.from(new Set(parsed.data.events.map((event) => event.name))),
  })

  return NextResponse.json({ ok: true, ...result })
}
