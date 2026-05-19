import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'
import { db, resetMocks } from '../../database/index.js'

// Here is the auth mock so we get a req.user and the controller can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /bulkUpdate route without auth that will use controller.bulkUpdate
routeTester.use("/bulkUpdate", [addAuth, controller.bulkUpdate])

process.env.RERUM_ID_PREFIX ??= 'https://store.rerum.io/v1/id/'

beforeEach(() => {
  resetMocks()
})

it("'/bulkUpdate' route functions", async () => {
  const originalId = '11111'
  const originalObject = {
    _id: originalId,
    '@id': `${process.env.RERUM_ID_PREFIX}${originalId}`,
    test: 'old-value',
    __rerum: {
      generatedBy: 'https://store.rerum.io/v1/id/agent007',
      history: { prime: 'root', previous: '', next: [] },
      isReleased: '',
      isOverwritten: '',
      releases: { previous: '', next: [], replaces: '' },
      createdAt: '2025-01-01T00:00:00.000'
    }
  }

  db.findOne.mockResolvedValueOnce(originalObject)
  db.bulkWrite.mockResolvedValueOnce({
    result: { insertedIds: [{ _id: 'bulk-update-id' }] },
    insertedIds: { 0: 'bulk-update-id' },
    insertedCount: 1
  })

  const response = await request(routeTester)
    .put('/bulkUpdate')
    .set('Content-Type', 'application/json')
    .send([
      { '@id': `${process.env.RERUM_ID_PREFIX}${originalId}`, test: 'updated-value' }
    ])

  assert.strictEqual(response.statusCode, 200)
  assert.ok(Array.isArray(response.body))
  assert.strictEqual(response.body.length, 1)
  assert.strictEqual(response.body[0]._id, undefined)
  assert.strictEqual(response.body[0].test, 'updated-value')
  assert.ok(String(response.headers.link).includes('bulk-update-id'))
})
