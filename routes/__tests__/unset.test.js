import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user so controller.patchUnset can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /unset route without auth that will use controller.patchUnset
routeTester.use("/unset", [addAuth, controller.patchUnset])

const MOCK_AGENT = "https://store.rerum.io/v1/id/agent007"
const MOCK_PREFIX = process.env.RERUM_ID_PREFIX ?? "https://store.rerum.io/v1/id/"
const MOCK_ORIG_ID = "11111"

const mockDoc = {
  _id: MOCK_ORIG_ID,
  "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`,
  test_obj: "to remove",
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

it("'/unset' route functions", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  const response = await request(routeTester)
    .patch("/unset")
    .set("Content-Type", "application/json")
    .send({ "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`, test_obj: null })

  assert.strictEqual(response.statusCode, 200)
  assert.strictEqual(response.body["test_obj"], undefined)
  assert.strictEqual(response.body._id, undefined)
  const returnedId = response.body["@id"] ?? response.body.id
  assert.strictEqual(response.headers["location"], returnedId)
})

// controllers/patchUnset.js:42 returns 501 (not 404) when the @id is not in RERUM.
// The contract declares 501 for this operation; without this test, removing the 501 guard
// would silently break the documented behavior while leaving the contract test passing.
it("'/unset' returns 501 when the target object is not in RERUM", async () => {
  db.findOne.mockResolvedValueOnce(null)
  const response = await request(routeTester)
    .patch("/unset")
    .set("Content-Type", "application/json")
    .send({ "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`, test_obj: null })

  assert.strictEqual(response.statusCode, 501)
})

