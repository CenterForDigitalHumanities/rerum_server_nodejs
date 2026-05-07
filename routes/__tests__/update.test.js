import { jest } from "@jest/globals"
import dotenv from "dotenv"
dotenv.config()
// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

// Here is the auth mock so we get a req.user so controller.create can function without a NPE.
const addAuth = (req, res, next) => {
  req.user = {"http://store.rerum.io/agent": "https://store.rerum.io/v1/id/agent007"}
  next()
}

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /create route without auth that will use controller.create
routeTester.use("/update", [addAuth, controller.putUpdate])
const unique = new Date(Date.now()).toISOString().replace("Z", "")

const MOCK_AGENT = "https://store.rerum.io/v1/id/agent007"
const MOCK_PREFIX = process.env.RERUM_ID_PREFIX ?? "https://store.rerum.io/v1/id/"
const MOCK_ORIG_ID = "11111"

const mockDoc = {
  _id: MOCK_ORIG_ID,
  "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`,
  "RERUM Update Test": "oldValue",
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

it("'/update' route functions", async () => {
  // putUpdate: findOne → original, insertOne → new version, replaceOne → update original's next
  db.findOne.mockResolvedValueOnce(mockDoc)
  const response = await request(routeTester)
    .put("/update")
    .set("Content-Type", "application/json")
    .send({ "@id": `${MOCK_PREFIX}${MOCK_ORIG_ID}`, "RERUM Update Test": unique })
  expect(response.statusCode).toBe(200)
  const returnedId = response.body["@id"] ?? response.body.id
  expect(returnedId).toBeTruthy()
  expect(response.headers["location"]).toBe(returnedId)
  expect(response.headers["location"]).not.toBe(`${MOCK_PREFIX}${MOCK_ORIG_ID}`)
  expect(response.body._id).toBeUndefined()
  expect(response.body["RERUM Update Test"]).toBe(unique)
})
