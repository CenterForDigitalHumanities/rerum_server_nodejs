const { MongoClient } = require('mongodb')
const dotenv = require('dotenv')
dotenv.config()

const client = new MongoClient(process.env.MONGO_CONNECTION_STRING)
exports.connected = async function () {
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 }).catch(err => err)
    return true
}
exports.db = client.db(process.env.MONGODBNAME)?.collection(process.env.MONGODBCOLLECTION)

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
