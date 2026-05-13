import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user so controller.create can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /create route without auth that will use controller.create
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


