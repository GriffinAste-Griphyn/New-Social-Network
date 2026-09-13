"use client"

import { useId } from "react"
import type { StoryImageContentMode } from "@/lib/story-media-contract"
import { cn } from "@/lib/utils"

export function StoryFramingControl({
  value,
  onChange,
  disabled = false,
}: {
  value: StoryImageContentMode
  onChange: (value: StoryImageContentMode) => void
  disabled?: boolean
}) {
  const groupName = useId()
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium">Photo framing</legend>
      <div className="flex gap-2">
        {(["fit", "fill"] as const).map((mode) => (
          <label key={mode} className={cn("relative cursor-pointer rounded-lg border px-3 py-2 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring", value === mode ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}>
            <input className="sr-only" type="radio" name={groupName} value={mode} checked={value === mode} onChange={() => onChange(mode)} />
            {mode === "fit" ? "Fit" : "Fill"}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value === "fit" ? "Keep the whole photo with black padding." : "Crop the photo to fill the story frame."}
      </p>
    </fieldset>
  )
}
