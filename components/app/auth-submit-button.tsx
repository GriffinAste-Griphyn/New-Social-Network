"use client"

import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type AuthSubmitButtonProps = {
  className?: string
  idleLabel: string
  pendingLabel: string
}

export function AuthSubmitButton({
  className,
  idleLabel,
  pendingLabel,
}: AuthSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      className={cn(
        "h-11 w-full rounded-full bg-black text-base text-white hover:bg-black/82",
        className,
      )}
      disabled={pending}
    >
      {pending ? pendingLabel : idleLabel}
    </Button>
  )
}
