import express from "express"
import request from "supertest"
import rest from '../../rest.js'

/**
 * Tests for the Content-Type validation middlewares: verifyJsonContentType, verifyTextContentType, and verifyEitherContentType.
 * Each middleware is applied per-route rather than as a blanket middleware.
 */

// Set up a minimal Express app mirroring the real app's body parsers
const routeTester = express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))
routeTester.use(express.text())

// JSON-only endpoints (like /api/create, /api/query, /api/update, etc.)
routeTester.post("/json-endpoint", rest.verifyJsonContentType, (req, res) => {
    res.status(200).json({ received: req.body })
})
routeTester.put("/json-endpoint", rest.verifyJsonContentType, (req, res) => {
    res.status(200).json({ received: req.body })
})
routeTester.patch("/json-endpoint", rest.verifyJsonContentType, (req, res) => {
    res.status(200).json({ received: req.body })
})

// Text-only endpoint
routeTester.post("/text-endpoint", rest.verifyTextContentType, (req, res) => {
    res.status(200).json({ received: req.body })
})

// Either JSON or text endpoint (like /api/search)
routeTester.post("/either-endpoint", rest.verifyEitherContentType, (req, res) => {
    res.status(200).json({ received: req.body })
})

// Error handler matching the app's pattern
routeTester.use(rest.messenger)

describe("verifyJsonContentType middleware", () => {

    it("accepts application/json", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json")
            .send({ test: "data" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.test).toBe("data")
    })

    it("accepts application/ld+json", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/ld+json")
            // Must stringify manually; supertest's .send(object) would override Content-Type to application/json
            .send(JSON.stringify({ "@context": "http://example.org", test: "ld" }))
        expect(response.statusCode).toBe(200)
        expect(response.body.received["@context"]).toBe("http://example.org")
    })

    it("accepts application/json with charset parameter", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; charset=utf-8")
            .send({ test: "charset" })
        expect(response.statusCode).toBe(200)
    })

    it("accepts application/ld+json with charset parameter", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/ld+json; charset=utf-8")
            // Must stringify manually; supertest's .send(object) would override Content-Type to application/json
            .send(JSON.stringify({ "@context": "http://example.org", test: "ld-charset" }))
        expect(response.statusCode).toBe(200)
    })

    it("accepts Content-Type with unusual casing", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "Application/JSON")
            .send({ test: "casing" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.test).toBe("casing")
    })

    it("accepts application/json on PUT", async () => {
        const response = await request(routeTester)
            .put("/json-endpoint")
            .set("Content-Type", "application/json")
            .send({ test: "put-data" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.test).toBe("put-data")
    })

    it("accepts application/json on PATCH", async () => {
        const response = await request(routeTester)
            .patch("/json-endpoint")
            .set("Content-Type", "application/json")
            .send({ test: "patch-data" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.test).toBe("patch-data")
    })

    it("returns 415 for missing Content-Type", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .unset("Content-Type")
            .send(Buffer.from('{"test":"data"}'))
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Missing or empty Content-Type header")
    })

    it("returns 415 for text/plain", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "text/plain")
            .send("some plain text")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
    })

    it("returns 415 for text/plain on PUT", async () => {
        const response = await request(routeTester)
            .put("/json-endpoint")
            .set("Content-Type", "text/plain")
            .send("some text")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
    })

    it("returns 415 for application/xml", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/xml")
            .send("<root/>")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
    })

    it("returns 415 for comma-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })

    it("returns 415 for comma-injected Content-Type parameter", async () => {
        // Even though the MIME type portion is valid, the comma in the full header
        // is rejected to prevent Content-Type smuggling via parameter injection.
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; charset=utf-8, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })

    it("returns 415 for semicolon-smuggled MIME type", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })

    it("returns 415 for semicolon-smuggled MIME type with valid parameter", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; charset=utf-8; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })
})

describe("verifyTextContentType middleware", () => {

    it("accepts text/plain", async () => {
        const response = await request(routeTester)
            .post("/text-endpoint")
            .set("Content-Type", "text/plain")
            .send("hello world")
        expect(response.statusCode).toBe(200)
        expect(response.body.received).toBe("hello world")
    })

    it("accepts text/plain with charset parameter", async () => {
        const response = await request(routeTester)
            .post("/text-endpoint")
            .set("Content-Type", "text/plain; charset=utf-8")
            .send("hello charset")
        expect(response.statusCode).toBe(200)
    })

    it("returns 415 for missing Content-Type", async () => {
        const response = await request(routeTester)
            .post("/text-endpoint")
            .unset("Content-Type")
            .send(Buffer.from("hello"))
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Missing or empty Content-Type header")
    })

    it("returns 415 for application/json", async () => {
        const response = await request(routeTester)
            .post("/text-endpoint")
            .set("Content-Type", "application/json")
            .send({ test: "data" })
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
        expect(response.text).toContain("text/plain")
    })

    it("returns 415 for comma-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/text-endpoint")
            .set("Content-Type", "text/plain, application/json")
            .send("hello")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })

    it("returns 415 for semicolon-smuggled MIME type", async () => {
        const response = await request(routeTester)
            .post("/text-endpoint")
            .set("Content-Type", "text/plain; application/json")
            .send("hello")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })
})

describe("verifyEitherContentType middleware", () => {

    it("accepts application/json", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .set("Content-Type", "application/json")
            .send({ searchText: "hello" })
        expect(response.statusCode).toBe(200)
        expect(response.body.received.searchText).toBe("hello")
    })

    it("accepts application/ld+json", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .set("Content-Type", "application/ld+json")
            // Must stringify manually; supertest's .send(object) would override Content-Type to application/json
            .send(JSON.stringify({ "@context": "http://example.org" }))
        expect(response.statusCode).toBe(200)
        expect(response.body.received["@context"]).toBe("http://example.org")
    })

    it("accepts text/plain", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .set("Content-Type", "text/plain")
            .send("search terms")
        expect(response.statusCode).toBe(200)
        expect(response.body.received).toBe("search terms")
    })

    it("returns 415 for missing Content-Type", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .unset("Content-Type")
            .send(Buffer.from("hello"))
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Missing or empty Content-Type header")
    })

    it("returns 415 for application/xml", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .set("Content-Type", "application/xml")
            .send("<root/>")
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Unsupported Content-Type")
    })

    it("returns 415 for comma-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .set("Content-Type", "application/json, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })

    it("returns 415 for semicolon-smuggled MIME type", async () => {
        const response = await request(routeTester)
            .post("/either-endpoint")
            .set("Content-Type", "application/json; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
        expect(response.text).toContain("Multiple Content-Type values are not allowed")
    })
})
