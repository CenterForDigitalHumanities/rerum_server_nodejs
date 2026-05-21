import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /id route without auth that will use controller.id (GET) and
// controller.idHeadRequest (HEAD). `.use()` is method-agnostic, so the explicit
// `.head()` entry must come first to intercept HEAD before the catch-all GET handler.
routeTester.head("/id/:_id", controller.idHeadRequest)
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
import { db, resetMocks } from '../../database/index.js'

beforeEach(() => {
  resetMocks()
})

it("'/id/:id' route functions", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  const response = await request(routeTester).get(`/id/${MOCK_ID}`)

  assert.strictEqual(response.statusCode, 200)
  assert.ok(response.body["@id"] ?? response.body.id)
  assert.strictEqual(response.body._id, undefined)
  assert.ok(response.body.__rerum)
})

describe('HEAD /id/:id', () => {
  it("returns 200 with Content-Length matching the GET body length", async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const getResp = await request(routeTester).get(`/id/${MOCK_ID}`)
    const getLen = Number(getResp.headers['content-length'])

    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const headResp = await request(routeTester).head(`/id/${MOCK_ID}`)

    assert.strictEqual(headResp.statusCode, 200)
    assert.ok(getLen > 0, 'GET must report a Content-Length')
    assert.strictEqual(Number(headResp.headers['content-length']), getLen)
    // HEAD must not carry a body.
    assert.ok(!headResp.body || Object.keys(headResp.body).length === 0)
  })

  it("returns 404 when the object is not in RERUM", async () => {
    db.findOne.mockResolvedValueOnce(null)
    const response = await request(routeTester).head(`/id/${MOCK_ID}`)
    assert.strictEqual(response.statusCode, 404)
  })
})

describe('id route overwrite headers', () => {
  it('includes the current overwrite version header for existing objects', async () => {
    const overwritten = structuredClone(mockDoc)
    overwritten.__rerum.isOverwritten = '2025-06-24T10:00:00'
    db.findOne.mockResolvedValueOnce(overwritten)

    const response = await request(routeTester).get(`/id/${MOCK_ID}`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['current-overwritten-version'], '2025-06-24T10:00:00')
  })

  it('uses an empty overwrite version header for never-overwritten objects', async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))

    const response = await request(routeTester).get(`/id/${MOCK_ID}`)

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['current-overwritten-version'], '')
  })
})
