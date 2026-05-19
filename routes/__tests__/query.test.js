import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /query route without auth that will use controller.query (POST)
// and controller.queryHeadRequest (HEAD). Order matters: `.head()` must precede
// `.use()` so the method-agnostic catch-all does not steal HEAD requests.
routeTester.head("/query", controller.queryHeadRequest)
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

describe('HEAD /query', () => {
  const buildCursor = (docs) => ({
    limit() { return this },
    skip() { return this },
    async toArray() { return docs }
  })

  // The Content-Length parity check only depends on what db.find returns —
  // the body the controller would have produced is the same whether the query
  // filter has 0 or N keys. supertest cannot send a JSON body on HEAD cleanly
  // (superagent rejects the object), so the request body is omitted here.

  it("returns 200 with Content-Length matching the POST body length", async () => {
    db.find.mockReturnValueOnce(buildCursor([mockDoc]))
    const postResp = await request(routeTester)
      .post("/query")
      .set("Content-Type", "application/json")
      .send({ test: "item" })
    const postLen = Number(postResp.headers['content-length'])

    db.find.mockReturnValueOnce(buildCursor([mockDoc]))
    const headResp = await request(routeTester).head("/query")

    assert.strictEqual(headResp.statusCode, 200)
    assert.ok(postLen > 0, 'POST must report a Content-Length')
    assert.strictEqual(Number(headResp.headers['content-length']), postLen)
    assert.ok(!headResp.body || Object.keys(headResp.body).length === 0)
  })

  it("returns 404 when no matches are found", async () => {
    db.find.mockReturnValueOnce(buildCursor([]))
    const response = await request(routeTester).head("/query")
    assert.strictEqual(response.statusCode, 404)
  })
})
