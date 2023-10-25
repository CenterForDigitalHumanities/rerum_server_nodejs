const { MongoClient } = require('mongodb')
const ObjectID = require('mongodb').ObjectId
const utils = require('../utils')
const config = require('../config')

const Database = ()=> {

    const client = new MongoClient(config.mongo.uri)
    const database = client.db(config.mongo.db).collection(config.mongo.collection)

    /**
     * Inserts a new record into RERUM. Returns the calculated URL before the write is complete.
     * Throws an error if the object is malformed or the slug is taken or invalid.
     * 
     * @param {JSON} data Object to be stored as a document in the database.
     * @param {Object} metadata Set of metadata options.
     * @param {URI} metadata.generator Reference for the generating Agent.
     * @param {String} metadata.slug Optional String to provide an alternate way to resolve the document.
     * @param {Boolean} metadata.isExternalUpdate Document updates an externally referenced resource
     * @returns URI of document to be saved. 
     * @throws Error for bad data or slug and passes back any MongoDB errors
     */
    const insert = async (data, metadata = {}, db = database) => {
        if (!isObject(data)) throw new Error('Invalid data object')
        if (!isValidURL(metadata.generator)) throw new Error('Invalid generator')
        if (!ObjectID.isValid(metadata.slug)) throw new Error('Invalid slug')
        const id = metadata.slug ?? new ObjectID().toHexString()
        const configuredDocument = utils.configureRerumOptions(metadata.generator, Object.assign(data, { _id: id, "@id": `${config.id_prefix}${id}` }), false, metadata.isExternalUpdate)
        db.insertOne(configuredDocument)
        delete configuredDocument._id
        return configuredDocument
    }

    return {
        client,
        insert,
        connect: client.connect
    }
}

exports = Database()

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
