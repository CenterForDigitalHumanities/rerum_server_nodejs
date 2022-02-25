const request = require("supertest")
const app = require("../../app")
const auth = require("../token")
const {createJWKSMock} = require("mock-jwks")


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
