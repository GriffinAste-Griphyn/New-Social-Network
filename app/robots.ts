import type { MetadataRoute } from "next";

import { getPublicSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/advertise", "/community-guidelines", "/privacy", "/terms"],
        disallow: [
          "/admin",
          "/advertiser",
          "/api",
          "/blocked-users",
          "/feed",
          "/onboarding",
          "/payouts",
          "/stats",
          "/stories",
        ],
      },
    ],
    sitemap: `${getPublicSiteUrl()}/sitemap.xml`,
  };
}
