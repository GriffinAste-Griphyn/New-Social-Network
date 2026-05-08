import type { StoryElementInput } from "@/lib/story-validators"

const moderationTerms = [
  { pattern: /\b(?:onlyfans|porn|nude|nsfw|escort)\b/i, label: "adult content" },
  { pattern: /\b(?:cocaine|fentanyl|heroin|meth|xanax)\b/i, label: "regulated substances" },
  { pattern: /\b(?:kill|murder|shoot|bomb|stab)\b/i, label: "violent language" },
  { pattern: /\b(?:scam|wire transfer|crypto giveaway|free money)\b/i, label: "fraud signal" },
  { pattern: /\b(?:self harm|suicide)\b/i, label: "self-harm signal" },
]

const suspiciousDomains = [
  "bit.ly",
  "tinyurl.com",
  "t.me",
  "telegram.me",
]

export type StoryModerationResult =
  | {
      status: "approved"
      reason: null
    }
  | {
      status: "flagged"
      reason: string
    }

function getLinkHosts(elements: StoryElementInput[]) {
  return elements.flatMap((element) => {
    if (!element.href) {
      return []
    }

    try {
      return [new URL(element.href).hostname.toLowerCase()]
    } catch {
      return []
    }
  })
}

export function evaluateStoryModeration(input: {
  caption: string
  explicitBrandTags: string[]
  elements: StoryElementInput[]
}): StoryModerationResult {
  const text = [
    input.caption,
    input.explicitBrandTags.join(" "),
    input.elements.map((element) => element.label).join(" "),
  ].join(" ")
  const matchedTerm = moderationTerms.find((term) => term.pattern.test(text))

  if (matchedTerm) {
    return {
      status: "flagged",
      reason: `Matched ${matchedTerm.label}.`,
    }
  }

  const matchedHost = getLinkHosts(input.elements).find((host) =>
    suspiciousDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    ),
  )

  if (matchedHost) {
    return {
      status: "flagged",
      reason: `Linked to suspicious domain ${matchedHost}.`,
    }
  }

  return {
    status: "approved",
    reason: null,
  }
}
