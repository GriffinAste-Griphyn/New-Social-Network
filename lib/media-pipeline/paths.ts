import { randomBytes } from "node:crypto"

import { mediaPipelineVersion } from "./contracts"

export function createMediaDeliveryPrefix() {
  return `media/${mediaPipelineVersion}/${randomBytes(18).toString("base64url")}`
}

export function migrateMediaDeliveryPrefix(
  outputPrefix: string,
  encoderVersion: string,
) {
  const safeVersion = encoderVersion.replace(/[^a-z0-9.-]/gi, "-")
  return `${outputPrefix}/encoder-${safeVersion}`
}

export function originalVideoPathname(input: {
  ownerUserId: string
  uploadSessionId: string
  extension: string
}) {
  const extension = input.extension.replace(/[^a-z0-9]/gi, "").toLowerCase()
  return `media-originals/${input.ownerUserId}/${input.uploadSessionId}/source.${extension || "mp4"}`
}

export function renditionPrefix(outputPrefix: string, label: string) {
  return `${outputPrefix}/${label}`
}
