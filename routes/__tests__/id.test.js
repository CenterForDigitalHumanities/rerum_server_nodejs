import { jest } from "@jest/globals"

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /id route without auth that will use controller.id
routeTester.use("/id/:_id", controller.id)

const MOCK_AGENT = "https://store.rerum.io/v1/id/agent007"
const MOCK_PREFIX = "https://store.rerum.io/v1/id/"
const MOCK_ID = "testid123"

const mockDoc = {
  _id: MOCK_ID,
  "@id": `${MOCK_PREFIX}${MOCK_ID}`,
  test: "item",
  __rerum: {
    generatedBy: MOCK_AGENT,
    history: { prime: "root", previous: "", next: [] },
    isReleased: "",
    isOverwritten: "",
    releases: { previous: "", next: [], replaces: "" },
    createdAt: "2025-01-01T00:00:00.000"
  }
}

// Import db mock so we can configure per-test behaviour
import { db } from '../../database/index.js'

it("'/id/:id' route functions", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  const response = await request(routeTester).get(`/id/${MOCK_ID}`)
  expect(response.statusCode).toBe(200)
  // idNegotiation strips _id; @id present (or id for LD contexts)
  expect(response.body["@id"] ?? response.body.id).toBeTruthy()
  expect(response.body._id).toBeUndefined()
  expect(response.body.__rerum).toBeDefined()
})

it.skip("Proper '@id-id' negotation on GET by URI.", async () => {
  // TODO
})
