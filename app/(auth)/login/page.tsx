import type { Metadata } from "next"

import {
  generateLoginMetadata,
  LoginPageView,
  type LoginSearchParams,
} from "@/components/app/login-page"

type LoginPageProps = {
  searchParams: Promise<LoginSearchParams>
}

export async function generateMetadata({
  searchParams,
}: LoginPageProps): Promise<Metadata> {
  return generateLoginMetadata(searchParams)
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  return <LoginPageView searchParams={searchParams} />
}
