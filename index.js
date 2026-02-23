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
