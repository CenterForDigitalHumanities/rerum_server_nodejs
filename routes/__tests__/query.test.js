import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'

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

import { db, resetMocks } from '../../database/index.js'

beforeEach(() => {
  resetMocks()
})

it("'/query' route functions", async () => {
  const queryCursor = {
    limit() {
      return this
    },
    skip() {
      return this
    },
    async toArray() {
      return [mockDoc]
    }
  }
  db.find.mockReturnValueOnce(queryCursor)
  const response = await request(routeTester)
    .post("/query")
    .set("Content-Type", "application/json")
    .send({ test: "item" })

  assert.strictEqual(response.statusCode, 200)
  assert.ok(Array.isArray(response.body))
  assert.ok(response.body.length > 0)
  assert.ok(response.body[0]["@id"])
  assert.strictEqual(response.body[0]._id, undefined)
})

it.skip("Proper '@id-id' negotation on objects returned from '/query'.", async () => {
  // TODO
})
