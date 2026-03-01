/**
 * Centralized MongoDB client for the RERUM API.
 * Provides a single shared MongoClient instance, connection
 * management, and collection access for the application.
 *
 * @module database/client
 * @author joeljoby02
 */
import { MongoClient, ObjectId } from 'mongodb'
import config from '../config/index.js'

// Single shared Mongo client for the entire application
const client = new MongoClient(config.MONGO_CONNECTION_STRING)

// connect immediately; callers may import `connect` if they want to await it
const connect = async () => {
    await client.connect()
    console.dir({
        db: config.MONGODBNAME,
        coll: config.MONGODBCOLLECTION
    })
}

// collection helper
const db = client.db(config.MONGODBNAME)?.collection(config.MONGODBCOLLECTION)

// simple utilities previously scattered in index.js
const newID = () => new ObjectId().toHexString()
const isValidID = (id) => ObjectId.isValid(id)

const connected = async function () {
    await client.db('admin').command({ ping: 1 }).catch(err => err)
    return true
}

// ensure connection is attempted at module load time (as before)
connect().catch(console.dir)

export {
    client,
    connect,
    db,
    newID,
    isValidID,
    connected,
    ObjectId
}
