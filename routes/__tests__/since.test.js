import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount /since for both GET (controller.since) and HEAD (controller.sinceHeadRequest).
// `.head()` must be registered before `.use()` to win over the method-agnostic mount.
routeTester.head("/since/:_id", controller.sinceHeadRequest)
routeTester.use("/since/:_id", controller.since)

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

it("'/since/:id' route functions", async () => {
	db.findOne.mockResolvedValueOnce(mockDoc)
	const response = await request(routeTester).get(`/since/${MOCK_ID}`)
	assert.strictEqual(response.statusCode, 200)
	assert.ok(Array.isArray(response.body))
})

describe('HEAD /since/:id', () => {
  it("returns 200 with Content-Length matching the GET body length", async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const getResp = await request(routeTester).get(`/since/${MOCK_ID}`)
    const getLen = Number(getResp.headers['content-length'])

    db.findOne.mockResolvedValueOnce(structuredClone(mockDoc))
    const headResp = await request(routeTester).head(`/since/${MOCK_ID}`)

    assert.strictEqual(headResp.statusCode, 200)
    assert.ok(getLen > 0, 'GET must report a Content-Length')
    assert.strictEqual(Number(headResp.headers['content-length']), getLen)
    assert.ok(!headResp.body || Object.keys(headResp.body).length === 0)
  })

  it("returns 404 when the object is not in RERUM", async () => {
    db.findOne.mockResolvedValueOnce(null)
    const response = await request(routeTester).head(`/since/${MOCK_ID}`)
    assert.strictEqual(response.statusCode, 404)
  })
})
