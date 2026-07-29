import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount /history matching routes/history.js: GET only, no HEAD handler.  Express answers HEAD through
// the GET handler and drops the body itself, which keeps HEAD's headers identical to GET's.
routeTester.use("/history/:_id", controller.history)

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

it("'/history/:id' route functions", async () => {
	db.findOne.mockResolvedValueOnce(mockDoc)
	const response = await request(routeTester).get(`/history/${MOCK_ID}`)
	assert.strictEqual(response.statusCode, 200)
	assert.ok(Array.isArray(response.body))
})

describe('HEAD /history/:id', () => {
  it("returns 200 with Content-Length matching the GET body length", async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const getResp = await request(routeTester).get(`/history/${MOCK_ID}`)
    const getLen = Number(getResp.headers['content-length'])

    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const headResp = await request(routeTester).head(`/history/${MOCK_ID}`)

    assert.strictEqual(headResp.statusCode, 200)
    assert.ok(getLen > 0, 'GET must report a Content-Length')
    assert.strictEqual(Number(headResp.headers['content-length']), getLen)
    assert.ok(!headResp.body || Object.keys(headResp.body).length === 0)
  })

  it("returns 404 when the object is not in RERUM", async () => {
    db.findOne.mockResolvedValueOnce(null)
    const response = await request(routeTester).head(`/history/${MOCK_ID}`)
    assert.strictEqual(response.statusCode, 404)
  })

  // RFC 9110 s9.3.2: HEAD sends the same headers a GET would.  Adding a .head() handler back to
  // routes/history.js would drop the ETag and the LD headers, and this test would catch it.
  it("sends the same headers as the GET, including the validators", async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const getResp = await request(routeTester).get(`/history/${MOCK_ID}`)

    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const headResp = await request(routeTester).head(`/history/${MOCK_ID}`)

    assert.ok(headResp.headers['etag'], 'HEAD must report an ETag to validate against')
    for (const header of ['etag', 'content-type', 'link', 'allow']) {
      assert.strictEqual(headResp.headers[header], getResp.headers[header],
        `HEAD and GET must agree on ${header}`)
    }
  })
})
