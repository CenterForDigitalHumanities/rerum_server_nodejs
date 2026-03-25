/**
 * Tests for the Content-Type validation middlewares verifyJsonContentType and verifyEitherContentType.
 * The following are examples of good Content-Type headers that should not result in a 415

    - application/ld+json
    - text/plain; a="b,c"
    - application/json; a="b,c"; xy=z
 * 
 * The following are the cases that should result in a 415 (not a 500)

  - application/json text/plain
  - application/json, text/plain
  - text/plain; application/json
  - text/plain; a=b, application/json
  - application/json; a=b; text/plain;
  - application/json; a=b text/plain;
  - application/json; charset=utf-8, text/plain
  - application/json;

  * If a request contains more than one Content-Type header, that should also result in a 415.
  *
  * @author thehabes
 */

import express from "express"
import request from "supertest"
import rest from '../../rest.js'

// Set up a minimal Express app mirroring the real app's body parsers
const routeTester = express()
routeTester.use(express.json({ type: ["application/json", "application/ld+json"] }))
routeTester.use(express.text())

// JSON-only endpoints (like /api/create, /api/query, /api/update, etc.)
routeTester.post("/json-endpoint", rest.verifyJsonContentType, (req, res) => {
    res.status(200).json({ received: req.body })
})

// Either JSON or text endpoint (like /api/search)
routeTester.post("/json-or-text-endpoint", rest.verifyEitherContentType, (req, res) => {
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
    })

    it("accepts application/ld+json", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/ld+json")
            // Must stringify manually; supertest's .send(object) would override Content-Type to application/json
            .send(JSON.stringify({ "@context": "http://example.org", test: "ld" }))
        expect(response.statusCode).toBe(200)
    })

    it("returns 415 for trailing semicolon without parameter", async () => {
        // A trailing semicolon is malformed per RFC 7231 and express.json() won't parse it
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json;")
            .send('{"test":"trailing-semicolon"}')
        expect(response.statusCode).toBe(415)
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

    it("accepts application/json with quoted comma in parameter", async () => {
        // Exercises the hasMultipleContentTypes quoted-string bypass: a="b,c" contains a comma
        // but it is inside quotes, so it should not be treated as a smuggled MIME type.
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", 'application/json; a="b,c"; xy=z')
            .send({ test: "quoted-param" })
        expect(response.statusCode).toBe(200)
    })

    it("accepts Content-Type with unusual casing", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "Application/JSON")
            .send({ test: "casing" })
        expect(response.statusCode).toBe(200)
    })

    it("returns 415 for missing Content-Type", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .unset("Content-Type")
            .send(Buffer.from('{"test":"data"}'))
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for text/plain", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "text/plain")
            .send("some plain text")
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for space-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for comma-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for comma-injected Content-Type parameter", async () => {
        // Even though the MIME type portion is valid, the comma in the full header
        // is rejected to prevent Content-Type smuggling via parameter injection.
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; charset=utf-8, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for semicolon-smuggled MIME type", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for semicolon-smuggled MIME type with valid parameter", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; charset=utf-8; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for space-smuggled MIME type after valid parameter", async () => {
        const response = await request(routeTester)
            .post("/json-endpoint")
            .set("Content-Type", "application/json; a=b; c=d text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })
})

describe("verifyEitherContentType middleware", () => {

    it("accepts application/json", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json")
            .send({ searchText: "hello" })
        expect(response.statusCode).toBe(200)
    })

    it("accepts application/ld+json", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/ld+json")
            // Must stringify manually; supertest's .send(object) would override Content-Type to application/json
            .send(JSON.stringify({ "@context": "http://example.org" }))
        expect(response.statusCode).toBe(200)
    })

    it("accepts text/plain", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "text/plain")
            .send("search terms")
        expect(response.statusCode).toBe(200)
    })

    it("accepts text/plain with quoted comma in parameter", async () => {
        // Exercises the hasMultipleContentTypes quoted-string bypass: a="b,c" contains a comma
        // but it is inside quotes, so it should not be treated as a smuggled MIME type.
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", 'text/plain; a="b,c"')
            .send("search terms")
        expect(response.statusCode).toBe(200)
    })

    it("returns 415 for missing Content-Type", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .unset("Content-Type")
            .send(Buffer.from("hello"))
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for application/xml", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/xml")
            .send("<root/>")
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for space-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for comma-separated multiple Content-Type values", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for comma-injected Content-Type parameter", async () => {
        // Even though the MIME type portion is valid, the comma in the full header
        // is rejected to prevent Content-Type smuggling via parameter injection.
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json; charset=utf-8, text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for semicolon-smuggled MIME type", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for semicolon-smuggled MIME type with valid parameter", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json; charset=utf-8; text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })

    it("returns 415 for space-smuggled MIME type after valid parameter", async () => {
        const response = await request(routeTester)
            .post("/json-or-text-endpoint")
            .set("Content-Type", "application/json; a=b; c=d text/plain")
            .send('{"test":"data"}')
        expect(response.statusCode).toBe(415)
    })
})
