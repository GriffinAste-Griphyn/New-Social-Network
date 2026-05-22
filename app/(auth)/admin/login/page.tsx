import type { Metadata } from "next"

import {
  generateLoginMetadata,
  LoginPageView,
  type LoginSearchParams,
} from "@/components/app/login-page"

type AdminLoginPageProps = {
  searchParams: Promise<LoginSearchParams>
}

async function adminLoginSearchParams(
  searchParams: Promise<LoginSearchParams>,
): Promise<LoginSearchParams> {
  const params = await searchParams

  return {
    ...params,
    next: "/admin",
  }
}

export async function generateMetadata({
  searchParams,
}: AdminLoginPageProps): Promise<Metadata> {
  return generateLoginMetadata(adminLoginSearchParams(searchParams), "/admin")
}

export default async function AdminLoginPage({
  searchParams,
}: AdminLoginPageProps) {
  return (
    <LoginPageView
      defaultNextPath="/admin"
      searchParams={adminLoginSearchParams(searchParams)}
    />
  )
}
