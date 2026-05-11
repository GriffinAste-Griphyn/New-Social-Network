import { networkInterfaces } from "node:os"

import Link from "next/link"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { ArrowLeft, Smartphone } from "lucide-react"
import QRCode from "qrcode"

import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Open UBEYE on mobile",
  description: "UBEYE consumer access is available on mobile web.",
}

type MobileOnlyPageProps = {
  searchParams: Promise<{
    next?: string
  }>
}

function safeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/feed"
  }

  return value
}

function getLanIpAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (
        address.family === "IPv4" &&
        !address.internal &&
        /^(10|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(address.address)
      ) {
        return address.address
      }
    }
  }

  return null
}

function getMobileUrl(input: {
  host: string | null
  protocol: string | null
  nextPath: string
}) {
  const fallbackHost = input.host ?? "localhost:3000"
  const protocol = input.protocol ?? "http"
  const hostname = fallbackHost.split(":")[0]
  const port = fallbackHost.includes(":")
    ? fallbackHost.slice(fallbackHost.indexOf(":"))
    : ""
  const isLocalhost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  const lanIpAddress = isLocalhost ? getLanIpAddress() : null
  const mobileHost = lanIpAddress ? `${lanIpAddress}${port}` : fallbackHost

  return new URL(input.nextPath, `${protocol}://${mobileHost}`).toString()
}

export default async function MobileOnlyPage({
  searchParams,
}: MobileOnlyPageProps) {
  const params = await searchParams
  const nextPath = safeNextPath(params.next)
  const headerList = await headers()
  const mobileUrl = getMobileUrl({
    host: headerList.get("host"),
    protocol: headerList.get("x-forwarded-proto"),
    nextPath,
  })
  const qrCodeSvg = await QRCode.toString(mobileUrl, {
    type: "svg",
    width: 220,
    margin: 1,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  })

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f2ec] px-5 py-10 text-black">
      <section className="w-full max-w-3xl rounded-[8px] border border-black/10 bg-[#faf9f5] p-6 shadow-[0_20px_70px_-52px_rgba(15,23,42,0.22)] sm:p-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-black/58 hover:text-black"
        >
          <ArrowLeft className="size-4" />
          Back to UBEYE
        </Link>

        <div className="mt-8 flex size-12 items-center justify-center rounded-full bg-black text-white">
          <Smartphone className="size-6" />
        </div>

        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
          Open this on your phone.
        </h1>
        <p className="mt-3 text-sm leading-6 text-black/62">
          UBEYE consumer access is limited to mobile web for now. Scan the QR
          code with a phone on the same Wi-Fi network to continue.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-center">
          <div className="rounded-[8px] border border-black/10 bg-white p-3">
            <div
              className="mx-auto size-[220px] overflow-hidden"
              aria-label={`QR code for ${mobileUrl}`}
              role="img"
              dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
            />
          </div>

          <div className="rounded-[8px] bg-white/70 p-4">
            <p className="text-sm font-semibold text-black">
              Local test URL
            </p>
            <p className="mt-2 break-all rounded-[8px] bg-black/5 p-3 font-mono text-sm leading-6 text-black/72">
              {mobileUrl}
            </p>
            <p className="mt-3 text-sm leading-6 text-black/58">
              If the QR does not load on your phone, make sure the phone is on
              the same Wi-Fi as this Mac and that the dev server is reachable
              from the local network.
            </p>
          </div>
        </div>

        <Button
          asChild
          className="mt-6 h-11 w-full rounded-full bg-black text-sm text-white hover:bg-black/84"
        >
          <Link href={mobileUrl}>Continue on mobile</Link>
        </Button>
      </section>
    </main>
  )
}
