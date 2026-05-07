import { jest } from "@jest/globals"

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /create route without auth that will use controller.history
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

import { db } from '../../database/index.js'

it("'/since/:id' route functions", async () => {
	// since: findOne returns the root object; getAllVersions calls db.find().toArray() → []
	// getAllDescendants on object with next:[] returns [] → response body is []
	db.findOne.mockResolvedValueOnce(mockDoc)
	const response = await request(routeTester).get(`/since/${MOCK_ID}`)
	expect(response.statusCode).toBe(200)
	expect(Array.isArray(response.body)).toBe(true)
})
