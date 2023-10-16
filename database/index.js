const { MongoClient } = require('mongodb')
const ObjectID = require('mongodb').ObjectId
const config = require('../config')

const client = new MongoClient(process.env.MONGO_CONNECTION_STRING)
const db = client.db(config.mongo.database).collection(config.mongo.collection)

/**
 * Inserts a new record into RERUM. Returns the calculated URL before the write is complete.
 * Throws an error if the object is malformed or the slug is taken or invalid.
 * 
 * @param {JSON} data Object to be stored as a document in the database.
 * @param {String} slug Optional String to provide an alternate way to resolve the document.
 * @returns URI of document to be saved. 
 */
async function insert(data, slug) {
    // validate data, validate slug
    const id = new ObjectID().toHexString()

    return `${config.mongo.id_prefix}id`
}

/**
 * Find a single record based on a query object.
 * @param {JSON} matchDoc Query Object to match properties.
 * @param {JSON} options Just mongodb passthru for now
 * @param {function} callback Callback function if needed
 * @returns Single matched document or `null` if there is none found.
 * @throws MongoDB error if matchDoc is malformed or server is unreachable
 */
function match(matchDoc, options, callback) {
    return db.findOne(matchDoc, options, (err, doc) => {
        if (typeof callback === 'function') return callback(err, doc)
        if (err) throw err
        return doc
    })
}

/**
 * Check for slug availability in RERUM.
 * @param {String} slug Desired new slug to check for collisions
 * @returns {Boolean} true if slug is available
 * @throws MongoDB error if there is any trobule checking
 */
function validateSlug(slug) {
    if (!slug) throw new Error(`Invalid slug attempted: "${slug}" should be a non-falsy String`)
    const result = match({ "$or": [{ "_id": slug_id }, { "__rerum.slug": slug_id }] })
    return result === null
}

/**
 * An internal helper for getting the agent from req.user
 * If you do not find an agent, the API does not know this requestor.
 * This means attribution is not possible, regardless of the state of the token.
 * The app is forbidden until registered with RERUM.  Access tokens are encoded with the agent.
 */
function getAgentClaim(req, next) {
    const claimKeys = [process.env.RERUM_AGENT_CLAIM, "http://devstore.rerum.io/v1/agent", "http://store.rerum.io/agent"]
    let agent = ""
    for (claimKey of claimKeys) {
        agent = req.user[claimKey]
        if (agent) {
            return agent
        }
    }
    let err = new Error("Could not get agent from req.user.  Have you registered with RERUM?")
    err.status = 403
    next(createExpressError(err))
}

export default {
    connect: client.connect
}

export { client }
