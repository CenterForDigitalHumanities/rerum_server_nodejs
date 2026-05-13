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

// FIXME here we need to create something to delete in order to test this route.
routeTester.use("/create", [addAuth, controller.create])

// TODO test the POST delete as well
//routeTester.use("/delete", [addAuth, controller.delete])

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
  const createResponse = await request(routeTester)
    .post("/create")
    .set("Content-Type", "application/json")
    .send({ test: "item" })
  assert.strictEqual(createResponse.statusCode, 201)

  db.findOne.mockResolvedValueOnce(mockDoc)
  const deleteResponse = await request(routeTester).delete(`/delete/${MOCK_ID}`)
  assert.strictEqual(deleteResponse.statusCode, 204)
})
