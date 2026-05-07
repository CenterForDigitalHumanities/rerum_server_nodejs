import { jest } from "@jest/globals"

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

// FIXME here we need to create something to release in order to test this route.
routeTester.use("/create", [addAuth, controller.create])

// Mount our own /release route without auth that will use controller.release
routeTester.use("/release/:_id", [addAuth, controller.release])
const slug = `rcgslu${new Date(Date.now()).toISOString().replace("Z", "")}`

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

import { db } from '../../database/index.js'

it("'/release' route functions", async () => {
  // create something to release
  const createResponse = await request(routeTester)
    .post("/create")
    .set("Content-Type", "application/json")
    .send({ test: "item" })
  expect(createResponse.statusCode).toBe(201)

  // release with slug:
  // 1st findOne for slug uniqueness check -> null
  // 2nd findOne to fetch object being released -> mockDoc
  db.findOne
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(mockDoc)

  const releaseResponse = await request(routeTester)
    .post(`/release/${MOCK_ID}`)
    .set("Slug", slug)
    .set("Content-Type", "application/json")

  expect(releaseResponse.statusCode).toBe(200)
  expect(releaseResponse.body._id).toBeUndefined()
  expect(releaseResponse.body.__rerum).toBeDefined()
  expect(releaseResponse.body.__rerum.isReleased).toBeTruthy()
  const returnedId = releaseResponse.body["@id"] ?? releaseResponse.body.id
  expect(releaseResponse.headers["location"]).toBe(returnedId)

  // cleanup slug object via internal helper path
  await controller.remove(slug)
})
