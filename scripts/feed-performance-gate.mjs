#!/usr/bin/env node
// Consume real benchmark output from FeedPerformanceTests; missing measurements
// fail rather than letting a release silently pass without its performance gate.
import { readFileSync, writeFileSync } from "node:fs"
const [logPath, outputPath] = process.argv.slice(2)
if (!logPath) throw new Error("Usage: node scripts/feed-performance-gate.mjs <native-test.log> [report.json]")
const lines = readFileSync(logPath, "utf8").split("\n")
const reports = lines.filter(line => line.includes("FEED_PERFORMANCE_BENCHMARK "))
  .map(line => JSON.parse(line.slice(line.indexOf("FEED_PERFORMANCE_BENCHMARK ") + "FEED_PERFORMANCE_BENCHMARK ".length)))
const report = reports.findLast(row => row.scenario === "feed_decode_50_creators")
if (!report || report.samples < 50 || report.environment !== "simulator" ||
    !Number.isFinite(report.p95Ms) || report.p95Ms < 0 || report.p95Ms >= 50 || report.payloadBytes < 10_000) {
  throw new Error("Feed decoding performance gate failed or benchmark evidence is missing")
}
if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n")
console.log(`Feed decode gate passed: p95 ${report.p95Ms.toFixed(2)} ms; ${report.samples} samples; ${report.payloadBytes} bytes.`)
