import { expect, it } from "vitest"
import type { POST as imagePost } from "@/app/api/queues/media-image-first-playable/route"
import type { POST as initialPost } from "@/app/api/queues/media-video-first-playable/route"
import type { POST as enhancementPost } from "@/app/api/queues/media-video-enhancement/route"

// Next validates the declared first argument, not merely whether the function
// can accept a Request. The SDK also accepts { request: Request }, so exporting
// its callback directly fails Next's production route validation.
type NextRequestArgument<T extends Request> = T
type QueueArguments = [
  NextRequestArgument<Parameters<typeof imagePost>[0]>,
  NextRequestArgument<Parameters<typeof initialPost>[0]>,
  NextRequestArgument<Parameters<typeof enhancementPost>[0]>,
]
const validNextArguments: QueueArguments extends [Request, Request, Request] ? true : false = true

it("declares Next-compatible Request arguments for every Queue consumer", () => {
  expect(validNextArguments).toBe(true)
})
