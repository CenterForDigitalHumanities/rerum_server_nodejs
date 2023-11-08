const { MongoClient } = require('mongodb')
const ObjectID = require('mongodb').ObjectId
const utils = require('../utils')
const config = require('../config').default

const database = jest.createMockFromModule('database')
exports.default = database()
