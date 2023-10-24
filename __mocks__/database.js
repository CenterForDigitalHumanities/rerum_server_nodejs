const database = jest.createMockFromModule('../database')

const client = new MongoClient(globalThis.__MONGO_URI__)
const db = client.db(`${config.mongo.db}Testing`).collection(config.mongo.collection)

exports = database
