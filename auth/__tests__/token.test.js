const request = require("supertest")
const express = require('express')
const app = express()
const auth = require("../token")
const createJWKSMock = require("mock-jwks").default

describe('Some tests for authentication for our api', () => {
    let jwksMock, req
    beforeEach(() => {
        ; ({ jwksMock, req } = createContext())
        app.get('/authorize', auth.checkJwt, (req, res) => {
            res.status(200).send()
        })
        app.get('/open', (req, res) => {
            res.status(200).send()
        })
    })
    afterEach(async () => tearDown({ jwksMock, app }))

    test('should not get access without correct token', async () => {
        // We start intercepting queries (see below)
        jwksMock.start()
        const { status } = await req.get('/authorize')
        expect(status).toBe(401)
    })
    test('should get access with mock token when jwksMock is running', async () => {
        // Again we start intercepting queries
        jwksMock.start()
        const access_token = jwksMock.token({
            aud: 'private',
            iss: 'master',
        })
        const { status } = await req
            .get('/authorize')
            .set('Authorization', `Bearer ${access_token}`)
        expect(status).toBe(200)
    })
    test('should not get access with mock token when jwksMock is not running', async () => {
        // Now we do not intercept queries. The queries of the middleware for the JKWS will
        // go to the production server and the local key will be invalid.
        const access_token = jwksMock.token({
            aud: 'private',
            iss: 'master',
        })
        const { status } = await req
            .get('/authorize')
            .set('Authorization', `Bearer ${access_token}`)
        expect(status).toBe(401)
    })
})

const createContext = () => {
    // This creates the local PKI
    const jwksMock = createJWKSMock('https://cubap.auth0.com/')

    // We start our app.
    app({
        jwksUri: 'https://cubap.auth0.com/.well-known/jwks.json',
    }).listen()

    const req = request(app)
    return {
        jwksMock,
        req
    }
}

const tearDown = async ({ jwksMock }) => {
    await app.close()
    await jwksMock.stop()
}

describe("Use the auth middleware.", () => {
    const jwks = createJWKSMock("https://cubap.auth0.com/")

    it("should verify the token", async () => {
        const token = jwks.token({})
        const data = await auth.checkJwt(token)
        expect(data).toEqual({})
    })

    it("should be an invalid token", async () => {
        expect.assertions(1);
        const token = jwks.token({
            exp: 0,
        })

        try {
            auth.checkJwt(token)
        } catch (error) {
            expect(error).toEqual(new TokenExpiredError("jwt expired"))
        }
    })

    test("It should response the GET method", async () => {
        const response = await request(app).get("/")
        expect(response.statusCode).toBe(200)
    })

    beforeEach(() => {
        jwks.start()
    })

    afterEach(() => {
        jwks.stop()
    })
})
