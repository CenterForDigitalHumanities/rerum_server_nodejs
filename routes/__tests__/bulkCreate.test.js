import { jest } from "@jest/globals"

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

import { db } from '../../database/index.js'

it("'/bulkCreate' route functions", async () => {
  // bulkCreate expects dbResponse.result.insertedIds as an array of objects with _id
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

  expect(response.statusCode).toBe(201)
  expect(Array.isArray(response.body)).toBe(true)
  expect(response.body.length).toBe(2)
  expect(response.body[0]._id).toBeUndefined()
  expect(response.body[1]._id).toBeUndefined()

  const linkHeader = response.headers['link']
  expect(linkHeader).toBeDefined()
  expect(String(linkHeader)).toContain(`${MOCK_PREFIX}id1`)
  expect(String(linkHeader)).toContain(`${MOCK_PREFIX}id2`)
})
