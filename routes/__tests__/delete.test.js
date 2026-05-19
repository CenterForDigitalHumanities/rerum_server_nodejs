import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user and the controller can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /delete route without auth that will use controller.delete
routeTester.use("/delete/:_id", [addAuth, controller.deleteObj])

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

it("'/delete' route functions", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  const deleteResponse = await request(routeTester).delete(`/delete/${MOCK_ID}`)
  assert.strictEqual(deleteResponse.statusCode, 204)
})

// The replacement document written by the controller must carry a __deleted shape
// with the deletor's agent, an ISO timestamp, and a snapshot of the original.
// A mutation that drops any of these would erase the soft-delete audit trail.
it("writes a __deleted audit shape (deletor, time, object snapshot) to the replacement document", async () => {
  db.findOne.mockResolvedValueOnce(mockDoc)
  let captured
  db.replaceOne.mockImplementationOnce(async (filter, replacement) => {
    captured = { filter, replacement }
    return { modifiedCount: 1 }
  })

  const response = await request(routeTester).delete(`/delete/${MOCK_ID}`)

  assert.strictEqual(response.statusCode, 204)
  assert.ok(captured, "db.replaceOne should have been called")
  assert.deepStrictEqual(captured.filter, { _id: MOCK_ID })
  assert.ok(captured.replacement.__deleted, "replacement must include __deleted")
  assert.strictEqual(captured.replacement.__deleted.deletor, MOCK_AGENT)
  assert.match(
    captured.replacement.__deleted.time,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    "__deleted.time should be an ISO-like timestamp"
  )
  assert.deepStrictEqual(
    captured.replacement.__deleted.object,
    mockDoc,
    "__deleted.object should preserve a snapshot of the original"
  )
  assert.strictEqual(captured.replacement["@id"], mockDoc["@id"], "@id is preserved on the deleted record")
})
