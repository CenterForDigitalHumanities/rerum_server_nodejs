/**
 * Small tests for just the action logic.
 * @author cubap
*/

jest.mock('database')
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

describe("create action",()=>{
    let mockReq = {
        header: (name)=>mockReq.headers[name],
        headers: {},
        body: {
            string: "potato",
            number: 55.4,
            nullProp: null,
            undefinedProp: undefined,
            boolean: true,
            object: { value: "objectValue" },
            array: [1,2,3,4]
        }
    }

    let mockRes = {
        status: (code)=>mockRes.statusCode = code,
        set: (header)=>mockRes.headers[header.key] = header.value,
        json: (data)=>mockRes.body = data,
        location: (url)=>mockRes.headers.location = url,
        headers: {}
    }

    let mockNext = (err)=> {
        if(err) {throw err}
    }

    it('should create a valid document', () =>{
        const create = require('./create').default
        const newDoc = create(mockReq, mockRes, mockNext)
        expect(newDoc).toHaveProperty('@id')
        expect(newDoc).toHaveProperty('__rerum')
        expect(newDoc).not.toHaveProperty('nullProp')
        expect(newDoc).not.toHaveProperty('undefinedProp')
    })

})
