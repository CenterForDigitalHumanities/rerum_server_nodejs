// database/index.js now acts as a thin facade around the
// shared MongoDB client located in database/client.js.  This keeps
// existing import paths in controllers/tests working while centralizing
// the connection logic in one place.

import * as clientModule from './client.js'

// re-export the most commonly used helpers so other modules can
// continue to import from "database/index.js" with no changes.
export const newID = clientModule.newID
export const isValidID = clientModule.isValidID
export const connected = clientModule.connected
export const db = clientModule.db

// Expose additional pieces if necessary; controllers rarely need
// them but we keep them available for future use.
export { client, connect } from './client.js'

/**
 * Find a single record based on a query object.
 * @param {JSON} matchDoc Query Object to match properties.
 * @param {JSON} options Just mongodb passthru for now
 * @param {function} callback Callback function if needed
 * @returns Single matched document or `null` if there is none found.
 * @throws MongoDB error if matchDoc is malformed or server is unreachable; E11000 duplicate key error collection
 */
function getMatching(matchDoc, options, callback) {
    return db.findOne(matchDoc, options, (err, doc) => {
        if (typeof callback === 'function') return callback(err, doc)
        if (err) throw err
        return doc
    })
}

function isObject(obj) {
    return obj?.constructor == Object
}

function isValidURL(url) {
    try {
        new URL(url)
        return true
    } catch (_) {
        return false
    }
}

export {
    newID,
    isValidID,
    connected,
    db
}
