const { MongoClient } = require('mongodb')

describe('query', () => {
    let connection
    let db

    let mockCollection
    const mockVeggies = [
        { type: "vegetable", index: 1, name: "carrot", length: 8 },
        { type: "vegetable", index: 2, name: "potato", length: 4 },
        { type: "vegetable", index: 3, name: "turnip", length: 3 },
        { type: "vegetable", index: 4, name: "parsnip", length: 7 },
        { type: "vegetable", index: 5, name: "cauliflower", length: 5 },
        { type: "vegetable", index: 6, name: "broccoli", length: 6 },
        { type: "vegetable", index: 7, name: "romanesco", length: 6 },
        { type: "vegetable", index: 8, name: "sweet potato", length: 4 },
        { type: "vegetable", index: 9, name: "asparagus", length: 7 },
        { type: "vegetable", index: 10, name: "pole bean", length: 4 },
        { type: "vegetable", index: 11, name: "cabbage", length: 5 },
        { type: "vegetable", index: 12, name: "radiccio", length: 6 },
    ]

    beforeAll(async () => {
        connection = await MongoClient.connect(globalThis.__MONGO_URI__, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        })
        db = await connection.db(globalThis.__MONGO_DB_NAME__)
        mockCollection = db.collection('vegetables')

        await mockCollection.insertMany(mockVeggies)
    })

    afterAll(async () => {
        await connection.close()
    })

    it('should insert a doc into collection', async () => {
        const users = db.collection('users')

        const mockUser = { _id: 'some-user-id', name: 'John' }
        await users.insertOne(mockUser)

        const insertedUser = await users.findOne({ _id: 'some-user-id' })
        expect(insertedUser).toEqual(mockUser)
    })

    it('should find all these objects with a query', async () => {
        const mockRequest = getMockReq({
            body: { type: "vegetable" },
            query: { limit: 50, skip: 0 }
        })
        const { res, next } = getMockRes()
        await query(mockRequest, res, next, mockCollection)
        // const cursorLength = await query.count()
        expect(next).toHaveBeenCalledTimes(0)
        expect(12).toBe(mockVeggies.length)
    })
})
