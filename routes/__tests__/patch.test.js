import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'
// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user so controller.patchUpdate can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /patch route without auth that will use controller.patch
routeTester.use("/patch", [addAuth, controller.patchUpdate])
const unique = new Date(Date.now()).toISOString().replace("Z", "")

const MOCK_AGENT = "https://store.rerum.io/v1/id/agent007"
const MOCK_PREFIX = process.env.RERUM_ID_PREFIX ?? "https://store.rerum.io/v1/id/"
const MOCK_ORIG_ID = "11111"

const mockDoc = {
  _id: MOCK_ORIG_ID,
  "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`,
  "RERUM Update Test": "oldValue",
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

it("'/patch' route functions", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  const response = await request(routeTester)
    .patch("/patch")
    .set("Content-Type", "application/json")
    .send({ "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`, "RERUM Update Test": unique })

  assert.strictEqual(response.statusCode, 200)
  const returnedId = response.body["@id"] ?? response.body.id
  assert.ok(returnedId)
  assert.strictEqual(response.headers["location"], returnedId)
  assert.strictEqual(response.body._id, undefined)
})

// controllers/patchUpdate.js:41 returns 501 (not 404) when the @id is not in RERUM.
// The contract declares 501 for this operation; without this test, removing the 501 guard
// would silently break the documented behavior while leaving the contract test passing.
it("'/patch' returns 501 when the target object is not in RERUM", async () => {
  db.findOne.mockResolvedValueOnce(null)
  const response = await request(routeTester)
    .patch("/patch")
    .set("Content-Type", "application/json")
    .send({ "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`, "RERUM Update Test": unique })

  assert.strictEqual(response.statusCode, 501)
})
