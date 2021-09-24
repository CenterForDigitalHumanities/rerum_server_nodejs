#!/usr/bin/env node
const { MongoClient } = require('mongodb');
var mongodbCollection = mongoConnection().then(conn => conn.db(process.env.MONGODBNAME)).then(db => db.collection(process.env.MONGODBCOLLECTION))

//Get all instances of this model.  Provide callback and limit if desired.
module.exports.mongodbCollection = mongoConnection().then(conn => conn.db(process.env.MONGODBNAME)).then(db => db.collection(process.env.MONGODBCOLLECTION));