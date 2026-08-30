import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { assertProductionEnvironment } from "./lib/env";
import { storyMediaContract } from "./lib/story-media-contract";

assertProductionEnvironment();

const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "@ffprobe-installer/ffprobe"],
  outputFileTracingIncludes: {
    // The media processor can be entered by upload/status recovery, the cron,
    // or its authenticated continuation route. These native binaries are
    // loaded through platform-specific packages, so every server trace that
    // imports the scheduler must explicitly carry them.
    "/api/mobile/stories/video-complete": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@ffprobe-installer/**/*",
    ],
    "/api/mobile/stories/*/status": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@ffprobe-installer/**/*",
    ],
    "/api/internal/media-processing": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@ffprobe-installer/**/*",
    ],
    "/api/cron/media-processing-reconcile": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@ffprobe-installer/**/*",
    ],
    "/.well-known/workflow/v1/*": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/@ffprobe-installer/**/*",
    ],
  },
  turbopack: {
    root: configDir,
  },
  compress: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "radix-ui"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.videodelivery.net",
      },
      {
        protocol: "https",
        hostname: "**.cloudflarestream.com",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "*.private.blob.vercel-storage.com",
      },
    ],
    formats: ["image/avif", "image/webp"],
    qualities: [75, storyMediaContract.imageEncoding.deliveryQuality],
    deviceSizes: [360, 640, 720, 1080, 1920],
    imageSizes: [64, 128, 256, 360],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default withWorkflow(nextConfig);
