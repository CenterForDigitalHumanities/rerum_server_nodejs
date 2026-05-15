import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'
import express from "express"
import request from "supertest"
import { db, resetMocks } from '../../database/index.js'
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user and the controller can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /create route without auth that will use controller.create
routeTester.use("/create", [addAuth, controller.create])

beforeEach(() => {
  resetMocks()
})

it("'/create' route functions", async () => {
  const response = await request(routeTester)
    .post("/create")
    .set("Content-Type", "application/json")
    .send({ test: "item" })

  assert.strictEqual(response.statusCode, 201)
  assert.ok(response.body["@id"] ?? response.body.id)
  assert.strictEqual(response.body._id, undefined)
  assert.ok(response.body.__rerum)
  assert.strictEqual(response.body.test, "item")

  const returnedId = response.body["@id"] ?? response.body.id
  assert.strictEqual(response.headers["location"], returnedId)
})

it.skip("Support setting valid '_id' on '/create' request body.", async () => {
  // TODO
})
