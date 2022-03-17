const { NextFunction, Request, Response } = require('express')
const auth = require("../../auth")

// REDO
describe('Authorization middleware',()=>{
    let mockRequest
    let mockResponse
    let nextFunction = jest.fn()

    beforeEach(() => {
        mockRequest = {};
        mockResponse = {
            json: jest.fn()
        }
    })

    // screwy middleware is an array, which I am not sure how to test...
    test('reject empty request without headers (INCOMPLETE)',async ()=>{
        auth.checkJwt[0](mockRequest,mockResponse,nextFunction)
        .catch(auth.checkJwt[1])
        expect(mockResponse.json)
    })

    test('with "authorization" header (INCOMPLETE)', async () => {
        mockRequest = {
            headers: {
                'authorization': 'Bearer blahblah'
            }
        }
        auth.checkJwt[0](mockRequest, mockResponse, nextFunction)

        expect(nextFunction);
    })
})
