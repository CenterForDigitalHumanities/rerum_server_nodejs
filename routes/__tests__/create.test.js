import { jest } from "@jest/globals"
import express from "express"
import request from "supertest"
import { db } from '../../database/index.js'
import controller from '../../db-controller.js'

const rerum_uri = `${process.env.RERUM_ID_PREFIX}123456`

// Here is the auth mock so we get a req.user and the controller can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /create route without auth that will use controller.create
routeTester.use("/create", [addAuth, controller.create])

it("'/create' route functions", async () => {
  // insertOne mock default resolves { insertedId: 'testid123' }
  // newID mock returns 'testid123', so @id = RERUM_ID_PREFIX + 'testid123'
  const response = await request(routeTester)
    .post("/create")
    .set("Content-Type", "application/json")
    .send({ test: "item" })
  expect(response.statusCode).toBe(201)
  expect(response.body["@id"] ?? response.body.id).toBeTruthy()
  expect(response.body._id).toBeUndefined()
  expect(response.body.__rerum).toBeDefined()
  expect(response.body.test).toBe("item")
  // location header should match the returned @id / id
  const returnedId = response.body["@id"] ?? response.body.id
  expect(response.headers["location"]).toBe(returnedId)
})

it.skip("Support setting valid '_id' on '/create' request body.", async () => {
  // TODO
})
