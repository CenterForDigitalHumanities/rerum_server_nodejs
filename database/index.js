const { MongoClient } = require('mongodb')
var ObjectID = require('mongodb').ObjectId

const client = new MongoClient(process.env.MONGO_CONNECTION_STRING)

export const database =  {
    connect:  client.connect
}
