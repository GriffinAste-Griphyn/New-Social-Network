import {
  resultFromSignals,
  type ContentModerationResult,
  type ModerationCategorySignal,
  type SafetyCategory,
} from "@/lib/safety/policy"

type LocalTextRule = {
  pattern: RegExp
  category: SafetyCategory
  reason: string
  confidence: number
}

const localTextRules: LocalTextRule[] = [
  {
    pattern: /\b(?:child porn|csam|minor nudes?|underage sex)\b/i,
    category: "minor_safety",
    reason: "Possible sexual content involving minors.",
    confidence: 0.98,
  },
  {
    pattern: /\b(?:onlyfans|porn|hardcore|nude|nudes|nsfw|escort|sexual services)\b/i,
    category: "sexual_content",
    reason: "Possible sexual or adult content.",
    confidence: 0.84,
  },
  {
    pattern: /\b(?:kill yourself|kys|suicide instructions|how to self harm)\b/i,
    category: "self_harm",
    reason: "Possible self-harm encouragement or instruction.",
    confidence: 0.94,
  },
  {
    pattern: /\b(?:rape|sexual assault|send nudes?|show me your nudes?|sexual abuse)\b/i,
    category: "sexual_content",
    reason: "Possible sexual abuse, harassment, or non-consensual sexual content.",
    confidence: 0.9,
  },
  {
    pattern: /\b(?:cocaine|fentanyl|heroin|meth|xanax|oxycontin|illegal drugs?)\b/i,
    category: "illegal_goods",
    reason: "Possible illegal or regulated goods.",
    confidence: 0.82,
  },
  {
    pattern: /\b(?:i(?:'| a)?m going to (?:kill|shoot|stab|hurt) you|i will (?:kill|shoot|stab|hurt) you|kill you|shoot you|stab you|bomb threat|murder you|massacre|graphic gore|beheading)\b/i,
    category: "violence",
    reason: "Possible violent content or threat.",
    confidence: 0.88,
  },
  {
    pattern: /\b(?:nazi|white power|racial slur|ethnic cleansing)\b/i,
    category: "hate",
    reason: "Possible hate speech or hateful symbol.",
    confidence: 0.78,
  },
  {
    pattern: /\b(?:wire transfer|crypto giveaway|free money|guaranteed profit|cashapp flip)\b/i,
    category: "fraud",
    reason: "Possible scam or fraud signal.",
    confidence: 0.8,
  },
]

const suspiciousDomains = [
  "bit.ly",
  "tinyurl.com",
  "t.me",
  "telegram.me",
  "wa.me",
  "cash.app",
]

function normalizeTextPart(value: string | null | undefined) {
  return value?.trim() ?? ""
}

function getLinkHost(value: string) {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function moderateTextLocally(input: {
  textParts: Array<string | null | undefined>
  linkUrls?: Array<string | null | undefined>
}): ContentModerationResult {
  const text = input.textParts.map(normalizeTextPart).join(" ")
  const textSignals = localTextRules.flatMap<ModerationCategorySignal>((rule) => {
    if (!rule.pattern.test(text)) {
      return []
    }

    return [
      {
        key: rule.category,
        confidence: rule.confidence,
        reason: rule.reason,
        source: "local_text",
      },
    ]
  })
  const linkSignals = (input.linkUrls ?? []).flatMap<ModerationCategorySignal>(
    (value) => {
      const trimmed = normalizeTextPart(value)
      const host = trimmed ? getLinkHost(trimmed) : null

      if (
        !host ||
        !suspiciousDomains.some(
          (domain) => host === domain || host.endsWith(`.${domain}`),
        )
      ) {
        return []
      }

      return [
        {
          key: "suspicious_link",
          confidence: 0.88,
          reason: `Linked to suspicious domain ${host}.`,
          source: "local_link",
        },
      ]
    },
  )

  return resultFromSignals({
    provider: "local-text",
    signals: [...textSignals, ...linkSignals],
  })
}
