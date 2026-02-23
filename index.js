// Public entry point for the RERUM API v1 server library
// Only the things exported here are considered a supported, stable
// API.  Internal helpers and modules (controllers, database, routes,
// etc.) remain private and are not re-exported.  Consumers of the
// package should be able to import from the package root rather than
// reach into deep paths.

import http from 'http'
import app from './app.js'

/**
 * Express application instance used throughout the project.  Exported
 * primarily for testing or embedding inside another server.
 *
 * ```js
 * import { app } from 'rerum_server'
 * ```
 */
export { app }

/**
 * Default export is the express app largely for backwards compatibility
 * with consumers that do `import app from 'rerum_server'`.
 */
export default app

/**
 * Helper that creates an HTTP server for the configured express app.
 * The returned server is **not** listening yet; caller may attach
 * additional listeners or configure timeouts before calling
 * `server.listen(...)`.
 *
 * @param {number|string} [port=process.env.PORT||3001] port to assign to
 *        the express app and eventually listen on
 * @returns {import('http').Server} http server instance
 */
export function createServer(port = process.env.PORT ?? 3001) {
  app.set('port', port)
  const server = http.createServer(app)

  // mirror the configuration from bin/rerum_v1.js so that programmatic
  // users get the same keep-alive behaviour as the CLI entry point.
  server.keepAliveTimeout = 8 * 1000
  server.headersTimeout = 8.5 * 1000

  return server
}

/**
 * Convenience function to start the server immediately.  Returns the
 * server instance so callers can close it in tests or hook events.
 *
 * @param {number|string} [port] optional port override
 * @returns {import('http').Server}
 */
export function start(port) {
  const p = port ?? process.env.PORT ?? 3001
  const server = createServer(p)
  server.listen(p)
  server.on('listening', () => {
    console.log('LISTENING ON ' + p)
  })
  return server
}
