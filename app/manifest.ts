import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UBEYE",
    short_name: "UBEYE",
    description:
      "A mobile web social network where people post, watch, engage, and participate in the value their attention creates.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f4f2ec",
    theme_color: "#000000",
    orientation: "portrait",
    categories: ["social", "entertainment"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "180x180",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "180x180",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  }
}
