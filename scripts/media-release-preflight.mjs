// Run backend checks in the release builder without exposing production credentials
// to test processes. Normal development builds keep their existing behavior.
import { spawn } from 'node:child_process'
if (process.env.MEDIA_RELEASE_VERIFY !== 'true') process.exit(0)
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test', AUTH_SECRET: 'release-test-only-not-a-production-credential',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2'], { env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('close', code => code === 0 ? resolve() : reject(Error(`Backend release tests failed (${code})`)))
})
