import { jest } from "@jest/globals"
jest.setTimeout(10000)

// Only real way to test an express route is to mount it and call it so that we can use the req, res, next.
import express from "express"
import request from "supertest"
import controller from '../../db-controller.js'

const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))

// Mount our own /history route without auth that will use controller.history
routeTester.use("/history/:_id", controller.history)

it.todo("'/history/:id' route functions")
