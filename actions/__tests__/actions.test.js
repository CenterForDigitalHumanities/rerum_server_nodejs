/**
 * Small tests for just the action logic.
 * @author cubap
*/

beforeAll(async () => {
    const connect = require('../../database').default.connect
    await connect()
})

// afterAll(async () => await require('../database').default.client.close())

describe("create action", () => {
    let mockReq = {
        header: (name) => mockReq.headers[name],
        headers: {},
        body: {
            string: "potato",
            number: 55.4,
            nullProp: null,
            undefinedProp: undefined,
            boolean: true,
            object: { value: "objectValue" },
            array: [1, 2, 3, 4]
        }
    }

    let mockRes = {
        status: (code) => mockRes.statusCode = code,
        set: (header) => mockRes.headers[header.key] = header.value,
        json: (data) => mockRes.body = data,
        location: (url) => mockRes.headers.location = url,
        headers: {}
    }

    let mockNext = (err) => {
        if (err) { throw err }
    }

    it('should create a valid document', () => {
        const create = require('../create')
        const newDoc = create(mockReq, mockRes, mockNext)
        expect(newDoc).toHaveProperty('@id')
        expect(newDoc).toHaveProperty('__rerum')
        expect(newDoc).not.toHaveProperty('nullProp')
        expect(newDoc).not.toHaveProperty('undefinedProp')
    })

})
