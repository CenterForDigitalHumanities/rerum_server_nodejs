// Root entry point for RERUM API v1
// Only stable and publicly intended interfaces are re‑exported here.
// Internal helpers, controllers, and routing live in submodules and are
// deliberately not exposed so that consumers can't depend on private
// implementation details.

// core pieces that may be reused by embedded applications or tests
export { default as app } from './app.js'
export { default as config } from './config/index.js'
export { default as utils } from './utils.js'
export { default as controller } from './db-controller.js'
export * as database from './database/index.js'
export {
  db,
  newID,
  isValidID,
  connected,
  client,
  connect
} from './database/index.js'
export { default as auth } from './auth/index.js'

// note: we intentionally do not re-export routes, individual controller
// modules, tests, or other implementation details.  If additional
// public APIs are required in the future, add them here and document
// their stability guarantees.
