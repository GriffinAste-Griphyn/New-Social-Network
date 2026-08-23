import { assertProductionEnvironment } from "@/lib/env"

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    assertProductionEnvironment()
    if (typeof performance !== "undefined" && "mark" in performance) {
      performance.mark("ubeye-instrumentation-ready")
    }
  }
}

export function onRequestError() {}
