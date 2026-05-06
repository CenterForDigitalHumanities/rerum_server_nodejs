import { jest } from "@jest/globals"

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /query route without auth that will use controller.query
routeTester.use("/query", controller.query)

it.todo("'/query' route functions")

it.skip("Proper '@id-id' negotation on objects returned from '/query'.", async () => {
  // TODO
})
