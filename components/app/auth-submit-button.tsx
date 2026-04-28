"use client"

import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"

type AuthSubmitButtonProps = {
  idleLabel: string
  pendingLabel: string
}

export function AuthSubmitButton({
  idleLabel,
  pendingLabel,
}: AuthSubmitButtonProps) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      className="h-11 w-full rounded-full bg-black text-base text-white hover:bg-black/82"
      disabled={pending}
    >
      {pending ? pendingLabel : idleLabel}
    </Button>
  )
}
