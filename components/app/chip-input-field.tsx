"use client"

import { KeyboardEvent, useMemo, useState } from "react"
import { Plus, X } from "lucide-react"

import { Input } from "@/components/ui/input"

function parseInitialValues(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ]
}

export function ChipInputField({
  defaultValue,
  description,
  label,
  name,
  placeholder,
}: {
  defaultValue: string
  description?: string
  label: string
  name: string
  placeholder: string
}) {
  const initialValues = useMemo(() => parseInitialValues(defaultValue), [defaultValue])
  const [items, setItems] = useState(initialValues)
  const [draft, setDraft] = useState("")

  function addDraft() {
    const value = draft.trim()

    if (!value) {
      return
    }

    setItems((current) => (current.includes(value) ? current : [...current, value]))
    setDraft("")
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return
    }

    event.preventDefault()
    addDraft()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={`${name}-draft`} className="text-sm font-medium">
          {label}
        </label>
        {description ? (
          <span className="text-xs text-[#71717a]">{description}</span>
        ) : null}
      </div>
      <input type="hidden" name={name} value={items.join(", ")} />
      <div className="rounded-[8px] border border-[#d4d4d8] bg-white p-2 focus-within:ring-[3px] focus-within:ring-[#a1a1aa]/40">
        <div className="flex min-h-10 flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex h-8 max-w-full items-center gap-2 rounded-[8px] bg-[#f4f4f5] px-2.5 text-sm text-[#18181b]"
            >
              <span className="truncate">{item}</span>
              <button
                type="button"
                onClick={() =>
                  setItems((current) => current.filter((value) => value !== item))
                }
                className="grid size-5 shrink-0 place-items-center rounded-full text-[#71717a] hover:bg-[#e4e4e7] hover:text-[#18181b]"
                title={`Remove ${item}`}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <Input
              id={`${name}-draft`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="h-8 border-0 px-1 shadow-none focus-visible:ring-0"
            />
            <button
              type="button"
              onClick={addDraft}
              className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#18181b] text-white hover:bg-[#27272a]"
              title={`Add ${label}`}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
