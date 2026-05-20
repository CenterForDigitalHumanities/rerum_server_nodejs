/**
 * Environment Variable Loader
 *
 * Preloads variables from a `.env` file into `process.env` before any
 * application module is imported. Used via Node's `--import` flag so that
 * it runs synchronously at process startup — works identically under
 * `node`, `c8`, `npm test`, and PM2 cluster workers (via `node_args` in
 * `ecosystem.config.json`).
 *
 * Replaces the previous `--env-file-if-exists=.env` Node CLI flag, which
 * was unreliable on the RHEL servers (vlcdhp02 / vlcdhprdp02) under PM2.
 *
 * Behavior:
 *   - Resolves `.env` against `process.cwd()` (same semantics as the
 *     deprecated flag).
 *   - Permissive: if `.env` is missing, logs a warning and continues
 *     with whatever is already in `process.env`.
 *   - Non-destructive: does NOT overwrite keys already set in
 *     `process.env`, so PM2-injected env, CI secrets, and shell exports
 *     still take precedence.
 *   - No external dependency — uses only `node:fs` and `node:path`.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const RESET = '\x1b[0m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'
const CYAN = '\x1b[36m'

const envPath = resolve(process.cwd(), '.env')

if (!existsSync(envPath)) {
  console.warn(`${YELLOW}[env-loader] .env not found at ${envPath} — continuing with existing process.env${RESET}`)
} else {
  let loaded = 0
  let skipped = 0
  const contents = readFileSync(envPath, 'utf8')
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
