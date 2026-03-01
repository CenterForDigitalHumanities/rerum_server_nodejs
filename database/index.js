/**
 * Database module backward compatibility layer.
 *
 * This module re-exports all symbols from database/client.js for backward
 * compatibility with legacy code. New code should import directly from
 * database/client.js instead. This layer maintains a single entry point
 * for any external consumers but does not add new functionality.
 *
 * @module database/index
 */

export {
    client,
    connect,
    db,
    newID,
    isValidID,
    connected,
    ObjectId
} from './client.js'
