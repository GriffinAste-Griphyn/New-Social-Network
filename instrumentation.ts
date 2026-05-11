import { assertProductionMediaEnvironment } from "@/lib/env"

export function register() {
  assertProductionMediaEnvironment()
}
