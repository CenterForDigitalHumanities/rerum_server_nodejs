import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user so controller.release can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /release route without auth that will use controller.release
routeTester.use("/release/:_id", [addAuth, controller.release])
const slug = `rcgslu${new Date(Date.now()).toISOString().replace("Z", "")}`

const MOCK_AGENT = "https://store.rerum.io/v1/id/agent007"
const MOCK_PREFIX = process.env.RERUM_ID_PREFIX ?? "https://store.rerum.io/v1/id/"
const MOCK_ID = "11111"

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

it("'/release' route functions", async () => {
  db.findOne
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(mockDoc)

  const releaseResponse = await request(routeTester)
    .patch(`/release/${MOCK_ID}`)
    .set("Slug", slug)
    .set("Content-Type", "application/json")

  assert.strictEqual(releaseResponse.statusCode, 200)
  assert.strictEqual(releaseResponse.body._id, undefined)
  assert.ok(releaseResponse.body.__rerum)
  assert.match(
    releaseResponse.body.__rerum.isReleased,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    "__rerum.isReleased should be an ISO-like timestamp"
  )
  const returnedId = releaseResponse.body["@id"] ?? releaseResponse.body.id
  assert.strictEqual(releaseResponse.headers["location"], returnedId)
})

// controllers/release.js:47-52 returns 404 when the target object is not in RERUM.
// The contract declares 404; without this test, dropping the guard would leave the contract
// test passing while production silently regressed to 500.
it("'/release' returns 404 when the target object is not in RERUM", async () => {
  db.findOne.mockResolvedValueOnce(null)

  const response = await request(routeTester)
    .patch(`/release/${MOCK_ID}`)
    .set("Content-Type", "application/json")

  assert.strictEqual(response.statusCode, 404)
})

// A slug conflict bubbles through generateSlugId (controllers/utils.js:106) as code 11000,
// which utils.createExpressError maps to 409. The contract declares 409 for this reason.
it("'/release' returns 409 when the requested Slug is already taken", async () => {
  db.findOne.mockResolvedValueOnce({ _id: "taken-slug" })

  const response = await request(routeTester)
    .patch(`/release/${MOCK_ID}`)
    .set("Slug", "taken-slug")
    .set("Content-Type", "application/json")

  assert.strictEqual(response.statusCode, 409)
})
