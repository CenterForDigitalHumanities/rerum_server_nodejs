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

it.todo("'/create' route functions")

it.skip("Support setting valid '_id' on '/create' request body.", async () => {
  // TODO
})
