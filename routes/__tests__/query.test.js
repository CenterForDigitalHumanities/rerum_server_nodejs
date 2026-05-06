import { jest } from "@jest/globals"

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /query route without auth that will use controller.query
routeTester.use("/query", controller.query)

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

import { db } from '../../database/index.js'

it("'/query' route functions", async () => {
  // Override the find cursor for this test to return one result
  const queryCursor = {
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([mockDoc])
  }
  db.find.mockReturnValueOnce(queryCursor)
  const response = await request(routeTester)
    .post("/query")
    .set("Content-Type", "application/json")
    .send({ test: "item" })
  expect(response.statusCode).toBe(200)
  expect(Array.isArray(response.body)).toBe(true)
  expect(response.body.length).toBeGreaterThan(0)
  expect(response.body[0]["@id"]).toBeTruthy()
  expect(response.body[0]._id).toBeUndefined()
})

it.skip("Proper '@id-id' negotation on objects returned from '/query'.", async () => {
  // TODO
})
