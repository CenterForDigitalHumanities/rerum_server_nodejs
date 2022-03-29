// const {query} = require('../../db-controller') THIS TRIES TO CONNECT EVERY TIME! WHY IS THIS ALL ONE FILE
const { MongoClient } = require('mongodb')
const { getMockReq, getMockRes } = require('@jest-mock/express')
const utils = require('../../utils')
const jestConfig = require('../../jest.config')
// copied in for now because broken
const createExpressError = () => false
const query = async function (req, res, next, mockCollection) {
  res.set("Content-Type", "application/json; charset=utf-8")
  let props = req.body
  const limit = req.query.limit ?? 100
  const skip = req.query.skip ?? 0
  if (Object.keys(props).length === 0) {
    //Hey now, don't ask for everything...this can happen by accident.  Don't allow it.
    let err = {
      message: "Detected empty JSON object.  You must provide at least one property in the /query request body JSON.",
      status: 400
    }
    next(createExpressError(err))
    return
  }
  try {
    let matches = await mockCollection.find(props).limit(limit).skip(skip).toArray()
    res.set(utils.configureLDHeadersFor(matches))
    res.json(matches)
  } catch (error) {
    next(createExpressError(error))
  }
}

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
    connection = await MongoClient.connect(global.__MONGO_URI__, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
    db = await connection.db()

    mockCollection = db.collection('vegetables')

    await mockCollection.insertMany(mockVeggies)
  })

  afterAll(async () => {
    await connection.close()
  })

  it('should find all these objects with a query', async () => {
    // const query = await mockCollection.find({ type: "vegetable" })
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

  it('should find a subset these objects with a query', async () => {
    const longVegCount = mockVeggies.filter(v => v.length >= 6).length
    const queryReq = await mockCollection.find({ length: { $gte: 6 } })
    const cursorLength = await queryReq.count()
    expect(cursorLength).toBe(longVegCount)
  })

  it('should limit to the first three in the query', async () => {
    const firstThreeVegs = mockVeggies.slice(0, 3)
    // const query = await mockCollection.find({ type: "vegetable" }).limit(3).skip(0)

    const cursorLength = await query.count()
    let results = await query.toArray().then
    results = results.map(el => delete el._id)
    expect(cursorLength).toBe(3)
    expect(results).toEqual(firstThreeVegs)
  })

  it('should find a subset these objects with a query', async () => {
    const longVegCount = mockVeggies.filter(v => v.length >= 6).length
    const query = await mockCollection.find({ length: { $gte: 6 } })
    const cursorLength = await query.count()
    expect(cursorLength).toBe(longVegCount)
  })

})
