const request = require("supertest")
const app = require("../app")

describe("Always true sanity check", ()=>{
    test('adds 1 + 2 to equal 3', () => {
        expect(1+2).toBe(3)
      })
})

describe("Test the root path", () => {
  test("It should response the GET method", async () => {
    const response = await request(app).get("/")
    expect(response.statusCode).toBe(200)
  })
})

