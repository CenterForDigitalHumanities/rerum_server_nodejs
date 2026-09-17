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

describe('pagination parameters on /query', () => {
  const pagedTester = express()
  pagedTester.use(express.json({ type: ["application/json", "application/ld+json"] }))
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

  it("rejects a limit or skip it cannot read exactly", async () => {
    for (const queryString of ["?limit=abc", "?skip=2.9"]) {
      const response = await post(queryString)
      assert.strictEqual(response.statusCode, 400, `${queryString} should be a 400`)
    }
  })

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

    // One record past the page is read to learn whether another page exists.
    assert.strictEqual(applied.limit, 8)
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
    for (const header of ['pagination-limit', 'pagination-skip', 'pagination-limit-max', 'pagination-skip-max']) {
      assert.strictEqual(response.headers[header], undefined, `${header} should not be set`)
    }
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

describe('rel="next" links on /query', () => {
  const pagedTester = express()
  pagedTester.use(express.json({ type: ["application/json", "application/ld+json"] }))
  pagedTester.post("/query", rest.verifyJsonContentType, controller.query)
  pagedTester.use(rest.messenger)

  /** A document in the shape the controller reads, whose '@id' ends in its '_id'. */
  const docWithId = (_id) => ({ ...mockDoc, _id, "@id": `${MOCK_PREFIX}${_id}` })

  /** The document ids of a /query response, in the order the endpoint returned them. */
  const idsOf = (response) => response.body.map(o => o["@id"].split("/").pop())

  /** The Link header of a response as { rel: url }. */
  const linksOf = (response) => Object.fromEntries(
    [...(response.headers.link ?? "").matchAll(/<([^>]+)>;\s*rel="([^"]+)"/g)].map(([, url, rel]) => [rel, url])
  )

  /** The query string of a link target, which may be absolute or path-only. */
  const paramsOf = (url) => new URL(url, "http://localhost").searchParams

  /**
   * A find() double over a fixed, '_id' ordered set of documents.  It honours the applied skip and
   * limit, so a walk over it pages the way the collection would.
   */
  const collectionOf = (docs) => () => {
    const window = { skip: 0, limit: Infinity }
    return {
      sort() { return this },
      limit(n) {
        window.limit = n
        return this
      },
      skip(n) {
        window.skip = n
        return this
      },
      async toArray() {
        return docs
          .slice(window.skip, window.skip + window.limit)
          .map(doc => structuredClone(doc))
      }
    }
  }

  const post = (path, body = { test: "item" }) => request(pagedTester)
    .post(path)
    .set("Content-Type", "application/json")
    .send(body)

  it("links the next page while more records exist, and serves only the page", async () => {
    db.find.mockImplementation(collectionOf(["a", "b", "c"].map(docWithId)))
    const response = await post("/query?limit=2")
    const links = linksOf(response)

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(idsOf(response), ["a", "b"])
    assert.ok(links.next, "a next link is present while more records exist")
    assert.strictEqual(paramsOf(links.next).get("limit"), "2")
    assert.strictEqual(paramsOf(links.next).get("skip"), "2")
  })

  it("keeps the JSON-LD context link alongside the next link", async () => {
    db.find.mockImplementation(collectionOf(["a", "b", "c"].map(docWithId)))
    const links = linksOf(await post("/query?limit=2"))
    assert.ok(links["http://www.w3.org/ns/json-ld#context"])
    assert.ok(links.next)
  })

  it("omits next on the final page", async () => {
    db.find.mockImplementation(collectionOf(["a", "b"].map(docWithId)))
    const response = await post("/query?limit=2")
    const links = linksOf(response)

    assert.deepStrictEqual(idsOf(response), ["a", "b"])
    assert.deepStrictEqual(Object.keys(links), ["http://www.w3.org/ns/json-ld#context"], "only the JSON-LD context link remains")
  })

  it("never serves the record read past the page, even at the maximum limit", async () => {
    db.find.mockImplementation(collectionOf([docWithId("a")]))
    const limitMax = Number((await post("/query?limit=1")).headers['pagination-limit-max'])
    const ids = Array.from({ length: limitMax + 1 }, (_, i) => `id${String(i).padStart(6, "0")}`)
    db.find.mockImplementation(collectionOf(ids.map(docWithId)))

    const response = await post(`/query?limit=${limitMax + 100}`)

    assert.strictEqual(response.body.length, limitMax)
    assert.ok(!idsOf(response).includes(ids.at(-1)), "the extra record must not be served")
    assert.ok(linksOf(response).next)
  })

  it("still links next past the skip maximum, so a walk too deep to finish ends in the 400 that names it", async () => {
    db.find.mockImplementation(collectionOf([docWithId("a")]))
    const skipMax = Number((await post("/query?limit=1")).headers['pagination-skip-max'])
    // Every page this double serves has a record past it, however deep the skip.
    db.find.mockImplementation(() => ({
      sort() { return this },
      limit() { return this },
      skip() { return this },
      async toArray() { return ["a", "b", "c"].map(docWithId) }
    }))

    const deepest = await post(`/query?limit=2&skip=${skipMax}`)
    const next = linksOf(deepest).next
    assert.strictEqual(deepest.statusCode, 200)
    assert.strictEqual(paramsOf(next).get("skip"), String(skipMax + 2), "absence would tell the client the walk was complete")

    const beyond = await post(`/query?${paramsOf(next)}`)
    assert.strictEqual(beyond.statusCode, 400)
    assert.strictEqual(beyond.headers['pagination-skip-max'], String(skipMax))
  })

  it("walks every record exactly once by following only rel=\"next\"", async () => {
    const ids = ["d01", "d02", "d03", "d04", "d05", "d06", "d07"]
    db.find.mockImplementation(collectionOf(ids.map(docWithId)))

    const walked = []
    let path = "/query?limit=3"
    for (let requests = 0; path; requests++) {
      assert.ok(requests < ids.length, "the walk must terminate")
      const response = await post(path)
      assert.strictEqual(response.statusCode, 200)
      walked.push(...idsOf(response))
      const next = linksOf(response).next
      path = next && `/query?${paramsOf(next)}`
    }

    assert.deepStrictEqual(walked, ids)
  })
})
