#!/bin/bash
# Reproducible local media regression run; no real posts or production credentials.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${MEDIA_TEST_DESTINATION:?Set MEDIA_TEST_DESTINATION to an iOS Simulator destination (platform=iOS Simulator,id=...)}"
case "$MEDIA_TEST_DESTINATION" in *"iOS Simulator"*) ;; *) echo 'This runner uses a simulator; physical device acceptance is documented separately.' >&2; exit 2;; esac
OUTPUT="${MEDIA_TEST_OUTPUT:-/tmp/ubeye-media-regression}"
mkdir -p "$OUTPUT"
cd "$ROOT"
node scripts/media-upload-quality-fixtures.mjs "$OUTPUT/fixtures"
node --import tsx scripts/media-encoding-experiments.mjs --input "$OUTPUT/fixtures" --output "$OUTPUT/encoding"
TEST_RUNNER_MEDIA_FIXTURE_DIRECTORY="$OUTPUT/fixtures" xcodebuild test \
  -project apps/ios/UBEYE.xcodeproj -scheme UBEYE -destination "$MEDIA_TEST_DESTINATION" \
  -resultBundlePath "$OUTPUT/MediaRegression-$(date +%s).xcresult" -parallel-testing-enabled NO -jobs 2 \
  -only-testing:UBEYETests/StoryUploadSchedulingTests \
  -only-testing:UBEYETests/MediaPipelineOwnershipTests \
  -only-testing:UBEYETests/StorySubmittedUploadTests \
  -only-testing:UBEYETests/StoryUploadBatchProgressTests \
  -only-testing:UBEYETests/MediaPerformanceTests \
  -only-testing:UBEYETests/PlaybackPolishTests \
  -only-testing:UBEYETests/StoryUploadPerformanceTests
