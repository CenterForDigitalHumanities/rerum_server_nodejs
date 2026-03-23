import { jest } from "@jest/globals"
import express from "express"
import request from "supertest"
import rest from '../../rest.js'

// Set up a minimal Express app with the Content-Type validation middleware
const routeTester = new express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))
routeTester.use(express.text())
routeTester.use(express.urlencoded({ extended: false }))

// Mount the validateContentType middleware on /api just like api-routes.js
routeTester.use("/api", rest.validateContentType)

// Simple JSON-only endpoint (like /api/create, /api/query, etc.)
routeTester.post("/api/create", (req, res) => {
    res.status(200).json({ received: req.body })
})

// Search endpoint that accepts text/plain
routeTester.post("/api/search", (req, res) => {
    res.status(200).json({ received: req.body })
})

// GET endpoint should pass through without Content-Type validation
routeTester.get("/api/info", (req, res) => {
    res.status(200).json({ info: true })
})

// Error handler matching the app's pattern
routeTester.use(rest.messenger)

describe("Content-Type validation middleware", () => {

    it("accepts application/json with valid JSON body", async () => {
        const response = await request(routeTester)
            .post("/api/create")
            .set("Content-Type", "application/json")
            .send({ test: "data" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.test).toBe("data")
    })

    it("accepts application/ld+json with valid JSON body", async () => {
        const response = await request(routeTester)
            .post("/api/create")
            .set("Content-Type", "application/ld+json")
            .send(JSON.stringify({ "@context": "http://example.org", test: "ld" }))
        expect(response.statusCode).toBe(200)
        expect(response.body.received["@context"]).toBe("http://example.org")
    })

    it("accepts application/json with charset parameter", async () => {
        const response = await request(routeTester)
            .post("/api/create")
            .set("Content-Type", "application/json; charset=utf-8")
            .send({ test: "charset" })
        expect(response.statusCode).toBe(200)
    })

    it("returns 415 for missing Content-Type header", async () => {
        const response = await request(routeTester)
            .post("/api/create")
            .unset("Content-Type")
            .send(Buffer.from('{"test":"data"}'))
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Missing Content-Type header")
    })

    it("returns 415 for text/plain on JSON-only endpoint", async () => {
        const response = await request(routeTester)
            .post("/api/create")
            .set("Content-Type", "text/plain")
            .send("some plain text")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
    })

    it("returns 415 for application/xml", async () => {
        const response = await request(routeTester)
            .post("/api/create")
            .set("Content-Type", "application/xml")
            .send("<root/>")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
    })

    it("allows text/plain on search endpoint", async () => {
        const response = await request(routeTester)
            .post("/api/search")
            .set("Content-Type", "text/plain")
            .send("search terms")
        expect(response.statusCode).toBe(200)
        expect(response.body.received).toBe("search terms")
    })

    it("allows application/json on search endpoint", async () => {
        const response = await request(routeTester)
            .post("/api/search")
            .set("Content-Type", "application/json")
            .send({ searchText: "hello" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.searchText).toBe("hello")
    })

    it("skips validation for GET requests", async () => {
        const response = await request(routeTester)
            .get("/api/info")
        expect(response.statusCode).toBe(200)
        expect(response.body.info).toBe(true)
    })

})
