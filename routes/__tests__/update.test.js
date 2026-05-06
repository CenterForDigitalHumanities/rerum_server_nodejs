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

it.todo("'/update' route functions")
