import { z } from "zod"

export const storyCaptionSchema = z.string().trim().max(220)
export const storyElementLabelSchema = z.string().trim().min(1).max(64)
export const storyLinkUrlSchema = z.url().max(320)

const brandSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) =>
    value
      .replace(/^[@#]+/, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  )
  .refine((value) => value.length >= 2 && value.length <= 32, {
    message: "Brand tags must be 2-32 characters long.",
  })

export function parseStoryCaption(value: FormDataEntryValue | null) {
  return storyCaptionSchema.parse(typeof value === "string" ? value : "")
}

export function parseBrandTags(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return []
  }

  const rawValues = value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)

  return [...new Set(rawValues.map((entry) => brandSlugSchema.parse(entry)))]
}

export function extractCaptionMentions(caption: string) {
  const matches = caption.match(/(?:^|\s)[@#]([a-z0-9][a-z0-9._-]{1,31})/gi) ?? []

  return [
    ...new Set(
      matches.map((match) =>
        brandSlugSchema.parse(match.trim().replace(/^[@#]+/, "")),
      ),
    ),
  ]
}

export type StoryElementInput = {
  kind: "text" | "sticker" | "link"
  label: string
  href?: string
  positionX?: string
  positionY?: string
}

function parseDelimitedElements(
  value: FormDataEntryValue | null,
  kind: "text" | "sticker",
  position?: {
    positionX?: string
    positionY?: string
  },
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return []
  }

  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((entry) => ({
      kind,
      label: storyElementLabelSchema.parse(entry),
      ...position,
    }))
}

function parsePositionPercent(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== "string") {
    return fallback.toFixed(2)
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return fallback.toFixed(2)
  }

  return Math.min(Math.max(parsed, 0), 100).toFixed(2)
}

export function parseStoryElements(formData: FormData): StoryElementInput[] {
  const textPosition = {
    positionX: parsePositionPercent(formData.get("textOverlayPositionX"), 50),
    positionY: parsePositionPercent(formData.get("textOverlayPositionY"), 74),
  }
  const elements: StoryElementInput[] = [
    ...parseDelimitedElements(formData.get("textOverlays"), "text", textPosition),
    ...parseDelimitedElements(formData.get("stickers"), "sticker"),
  ]
  const linkLabel = formData.get("linkLabel")
  const linkUrl = formData.get("linkUrl")

  if (
    typeof linkLabel === "string" &&
    linkLabel.trim().length > 0 &&
    typeof linkUrl === "string" &&
    linkUrl.trim().length > 0
  ) {
    elements.push({
      kind: "link",
      label: storyElementLabelSchema.parse(linkLabel),
      href: storyLinkUrlSchema.parse(linkUrl.trim()),
    })
  }

  return elements.slice(0, 12)
}
