import { mobileStoryInteractionInboxResponse } from "@/lib/mobile-story-interaction-inbox"

export const runtime = "nodejs"

export async function GET(request: Request) {
  return mobileStoryInteractionInboxResponse(request)
}
