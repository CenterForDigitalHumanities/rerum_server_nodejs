/**
 * Environment Variable Loader
 *
 * Preloads variables from a `.env` file into `process.env` before any
 * application module reads them. Runs synchronously as a side-effect import.
 *
 * Two entry points use this loader, by design:
 *   1. The app entry script `bin/rerum_v1.js` imports this file FIRST,
 *      before any other module. Because ES module imports evaluate in
 *      source order, this guarantees `process.env` is populated before
 *      `app.js` (or anything it pulls in) reads it. This is the path used
 *      under PM2 in development and production, and it is independent of
 *      PM2's `node_args` / cluster-worker `execArgv` plumbing — which was
 *      observed not to fire reliably on the RHEL servers
 *      (vlcdhp02 / vlcdhprdp02).
 *   2. The test/coverage scripts in `package.json` pass it via
 *      `node --import ./env-loader.js`, because tests do not go through
 *      `bin/rerum_v1.js`.
 *
 * Replaces the previous `--env-file-if-exists=.env` Node CLI flag, which
 * was unreliable on the RHEL servers under PM2.
 *
 * Behavior:
 *   - Resolves `.env` against this file's own directory (via
 *     `import.meta.url`), NOT `process.cwd()`. PM2 cluster workers on
 *     RHEL have shown inconsistent cwd handling; anchoring to the file
 *     location guarantees the same `.env` is found regardless of where
 *     the process was launched from.
 *   - Permissive: if `.env` is missing, logs a warning and continues
 *     with whatever is already in `process.env`.
 *   - Non-destructive: does NOT overwrite keys already set in
 *     `process.env`, so PM2-injected env, CI secrets, and shell exports
 *     still take precedence.
 *   - Strips a leading UTF-8 BOM (U+FEFF) if present, so `.env` files
 *     saved by Windows editors do not lose their first key.
 *   - No external dependency — uses only `node:fs`, `node:path`, and
 *     `node:url`.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESET = '\x1b[0m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '.env')

if (!existsSync(envPath)) {
  console.warn(`${YELLOW}[env-loader] .env not found at ${envPath} — continuing with existing process.env${RESET}`)
} else {
  let loaded = 0
  let skipped = 0
  let contents = readFileSync(envPath, 'utf8')
  if (contents.charCodeAt(0) === 0xFEFF) contents = contents.slice(1)
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (key in process.env) {
      skipped++
      continue
    }
    process.env[key] = val
    loaded++
  }
  console.log(`${GREEN}[env-loader] loaded ${loaded} vars from ${envPath}${RESET}${skipped ? ` ${CYAN}(skipped ${skipped} already set)${RESET}` : ''}`)
}
