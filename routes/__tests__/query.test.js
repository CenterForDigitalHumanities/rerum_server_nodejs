import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'
import rest from '../../rest.js'

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
    sort() {
      return this
    },
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
    sort() { return this },
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

describe('pagination parameters on /query', () => {
  // rest.messenger renders the 400s that getPagination throws.  The routeTester above deliberately
  // mounts no error handler, so these get their own app rather than changing how it behaves.
  // Mounted the way routes/query.js mounts it, verifyJsonContentType included, so the order the
  // real app answers in is what is under test: a Content-Type it cannot accept is a 415 before any
  // pagination parameter is read.
  const pagedTester = express()
  pagedTester.use(express.json({ type: ["application/json", "application/ld+json"] }))
  pagedTester.head("/query", controller.queryHeadRequest)
  pagedTester.post("/query", rest.verifyJsonContentType, controller.query)
  pagedTester.use(rest.messenger)

  /** A cursor that records the limit and skip the controller actually applied. */
  const recordingCursor = (docs, applied) => ({
    sort(order) {
      applied.sort = order
      return this
    },
    limit(n) {
      applied.limit = n
      return this
    },
    skip(n) {
      applied.skip = n
      return this
    },
    async toArray() { return docs }
  })

  const post = (queryString) => {
    db.find.mockReturnValueOnce(recordingCursor([mockDoc], {}))
    return request(pagedTester)
      .post(`/query${queryString}`)
      .set("Content-Type", "application/json")
      .send({ test: "item" })
  }

  // The rejected forms themselves are covered against getPagination in __tests__/utils.test.js.
  // What is left to prove here is the wiring: the controller reads req.query, and the 400 it
  // throws reaches the client as a 400 rather than as an unhandled error.
  it("rejects a limit or skip it cannot read exactly", async () => {
    for (const queryString of ["?limit=abc", "?skip=2.9"]) {
      const response = await post(queryString)
      assert.strictEqual(response.statusCode, 400, `${queryString} should be a 400`)
    }
  })

  // Asserted over HTTP rather than only against getPagination, because this is what proves
  // Express really does hand a repeated parameter over as the Array that getPagination rejects.
  it("rejects a repeated limit rather than taking one of the two values", async () => {
    assert.strictEqual((await post("?limit=100&limit=200")).statusCode, 400)
  })

  it("reports the applied limit and skip, and the maximums, on a paged response", async () => {
    const response = await post("?limit=25&skip=10")
    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['pagination-limit'], '25')
    assert.strictEqual(response.headers['pagination-skip'], '10')
    assert.ok(Number(response.headers['pagination-limit-max']) > 0)
    assert.ok(Number(response.headers['pagination-skip-max']) > 0)
  })

  it("applies the reported limit and skip to the database cursor, over a deterministic order", async () => {
    const applied = {}
    db.find.mockReturnValueOnce(recordingCursor([mockDoc], applied))
    const response = await request(pagedTester)
      .post("/query?limit=7&skip=3")
      .set("Content-Type", "application/json")
      .send({ test: "item" })

    assert.strictEqual(applied.limit, 7)
    assert.strictEqual(applied.skip, 3)
    // A skip offset means nothing without a stable order to count into.
    assert.deepStrictEqual(applied.sort, { _id: 1 })
    assert.strictEqual(response.headers['pagination-limit'], '7')
    assert.strictEqual(response.headers['pagination-skip'], '3')
  })

  it("rejects a skip beyond the maximum instead of repeating the last page", async () => {
    const paged = await post("?limit=2&skip=0")
    const skipMax = Number(paged.headers['pagination-skip-max'])

    assert.strictEqual((await post(`?skip=${skipMax}`)).statusCode, 200, 'the maximum itself is still readable')

    const response = await post(`?skip=${skipMax + 1}`)
    assert.strictEqual(response.statusCode, 400)
    assert.match(response.text, new RegExp(`beyond the maximum of ${skipMax}`))
    // The ceilings still come back, so a paged walk can tell this boundary from any other 400.
    assert.strictEqual(response.headers['pagination-skip-max'], String(skipMax))
    assert.ok(Number(response.headers['pagination-limit-max']) > 0)
    assert.strictEqual(response.headers['pagination-limit'], undefined, 'no page was served')
    assert.strictEqual(response.headers['pagination-skip'], undefined, 'no page was served')
  })

  it("reports no page on the empty body 400, because none was served", async () => {
    const response = await request(pagedTester)
      .post("/query?limit=25&skip=5")
      .set("Content-Type", "application/json")
      .send({})

    assert.strictEqual(response.statusCode, 400)
    assert.match(response.text, /Detected empty JSON object/)
    for (const header of ['pagination-limit', 'pagination-skip', 'pagination-limit-max', 'pagination-skip-max']) {
      assert.strictEqual(response.headers[header], undefined, `${header} should not be set`)
    }
  })

  it("rejects the same values on HEAD /query", async () => {
    db.find.mockReturnValueOnce(recordingCursor([mockDoc], {}))
    const response = await request(pagedTester).head("/query?limit=abc")
    assert.strictEqual(response.statusCode, 400)
  })

  it("answers an unacceptable Content-Type before it reads a pagination parameter", async () => {
    // Both faults are present.  The Content-Type is the one the endpoint can answer without
    // looking at the query string, so it is the one that should decide the status.
    db.find.mockReturnValueOnce(recordingCursor([mockDoc], {}))
    const response = await request(pagedTester)
      .post("/query?limit=abc")
      .set("Content-Type", "text/plain")
      .send("not json")

    assert.strictEqual(response.statusCode, 415)
    for (const header of ['pagination-limit-max', 'pagination-skip-max']) {
      assert.strictEqual(response.headers[header], undefined, `${header} should not be set`)
    }
  })
})
