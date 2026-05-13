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

process.env.RERUM_ID_PREFIX ??= "https://store.rerum.io/v1/id/"

// Mount our own /bulkCreate route without auth that will use controller.bulkCreate
routeTester.use("/bulkCreate", [addAuth, controller.bulkCreate])

const MOCK_PREFIX = process.env.RERUM_ID_PREFIX ?? "https://store.rerum.io/v1/id/"

import { db, resetMocks } from '../../database/index.js'

beforeEach(() => {
  resetMocks()
})

it("'/bulkCreate' route functions", async () => {
  db.bulkWrite.mockResolvedValueOnce({
    result: { insertedIds: [{ _id: 'id1' }, { _id: 'id2' }] },
    insertedIds: { 0: 'id1', 1: 'id2' },
    insertedCount: 2
  })

  const response = await request(routeTester)
    .post('/bulkCreate')
    .set('Content-Type', 'application/json')
    .send([
      { test: 'data-1' },
      { test: 'data-2' }
    ])

  assert.strictEqual(response.statusCode, 201)
  assert.ok(Array.isArray(response.body))
  assert.strictEqual(response.body.length, 2)
  assert.strictEqual(response.body[0]._id, undefined)
  assert.strictEqual(response.body[1]._id, undefined)

  const linkHeader = response.headers['link']
  assert.ok(linkHeader)
  assert.match(String(linkHeader), new RegExp(`${MOCK_PREFIX}id1`))
  assert.match(String(linkHeader), new RegExp(`${MOCK_PREFIX}id2`))
})
