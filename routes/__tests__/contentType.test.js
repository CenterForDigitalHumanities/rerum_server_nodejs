import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
    const acceptedJsonCases = [
        { name: 'accepts application/json', contentType: 'application/json', body: { test: 'data' }, expectedStatus: 200 },
        { name: 'accepts application/ld+json', contentType: 'application/ld+json', body: JSON.stringify({ '@context': 'http://example.org', test: 'ld' }), expectedStatus: 200 },
        { name: 'accepts application/json with charset parameter', contentType: 'application/json; charset=utf-8', body: { test: 'charset' }, expectedStatus: 200 },
        { name: 'accepts application/ld+json with charset parameter', contentType: 'application/ld+json; charset=utf-8', body: JSON.stringify({ '@context': 'http://example.org', test: 'ld-charset' }), expectedStatus: 200 },
        { name: 'accepts application/json with quoted comma in parameter', contentType: 'application/json; a="b,c"; xy=z', body: { test: 'quoted-param' }, expectedStatus: 200 },
        { name: 'accepts Content-Type with unusual casing', contentType: 'Application/JSON', body: { test: 'casing' }, expectedStatus: 200 }
    ]

    const rejectedJsonCases = [
        { name: 'returns 415 for trailing semicolon without parameter', contentType: 'application/json;', body: '{"test":"trailing-semicolon"}' },
        { name: 'returns 415 for text/plain', contentType: 'text/plain', body: 'some plain text' },
        { name: 'returns 415 for space-separated multiple Content-Type values', contentType: 'application/json text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for comma-separated multiple Content-Type values', contentType: 'application/json, text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for comma-injected Content-Type parameter', contentType: 'application/json; charset=utf-8, text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for semicolon-smuggled MIME type', contentType: 'application/json; text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for semicolon-smuggled MIME type with valid parameter', contentType: 'application/json; charset=utf-8; text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for space-smuggled MIME type after valid parameter', contentType: 'application/json; a=b; c=d text/plain', body: '{"test":"data"}' }
    ]

    for (const testCase of acceptedJsonCases) {
        it(testCase.name, async () => {
            const response = await request(routeTester)
                .post('/json-endpoint')
                .set('Content-Type', testCase.contentType)
                .send(testCase.body)
            assert.strictEqual(response.statusCode, testCase.expectedStatus)
        })
    }

    it('returns 415 for missing Content-Type', async () => {
        const response = await request(routeTester)
            .post('/json-endpoint')
            .unset('Content-Type')
            .send(Buffer.from('{"test":"data"}'))
        assert.strictEqual(response.statusCode, 415)
    })

    for (const testCase of rejectedJsonCases) {
        it(testCase.name, async () => {
            const response = await request(routeTester)
                .post('/json-endpoint')
                .set('Content-Type', testCase.contentType)
                .send(testCase.body)
            assert.strictEqual(response.statusCode, 415)
        })
    }
})

describe("verifyEitherContentType middleware", () => {
    const acceptedEitherCases = [
        { name: 'accepts application/json', contentType: 'application/json', body: { searchText: 'hello' }, expectedStatus: 200 },
        { name: 'accepts application/ld+json', contentType: 'application/ld+json', body: JSON.stringify({ '@context': 'http://example.org' }), expectedStatus: 200 },
        { name: 'accepts text/plain', contentType: 'text/plain', body: 'search terms', expectedStatus: 200 },
        { name: 'accepts text/plain with quoted comma in parameter', contentType: 'text/plain; a="b,c"', body: 'search terms', expectedStatus: 200 }
    ]

    const rejectedEitherCases = [
        { name: 'returns 415 for application/xml', contentType: 'application/xml', body: '<root/>' },
        { name: 'returns 415 for space-separated multiple Content-Type values', contentType: 'application/json text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for comma-separated multiple Content-Type values', contentType: 'application/json, text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for comma-injected Content-Type parameter', contentType: 'application/json; charset=utf-8, text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for semicolon-smuggled MIME type', contentType: 'application/json; text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for semicolon-smuggled MIME type with valid parameter', contentType: 'application/json; charset=utf-8; text/plain', body: '{"test":"data"}' },
        { name: 'returns 415 for space-smuggled MIME type after valid parameter', contentType: 'application/json; a=b; c=d text/plain', body: '{"test":"data"}' }
    ]

    for (const testCase of acceptedEitherCases) {
        it(testCase.name, async () => {
            const response = await request(routeTester)
                .post('/json-or-text-endpoint')
                .set('Content-Type', testCase.contentType)
                .send(testCase.body)
            assert.strictEqual(response.statusCode, testCase.expectedStatus)
        })
    }

    it('returns 415 for missing Content-Type', async () => {
        const response = await request(routeTester)
            .post('/json-or-text-endpoint')
            .unset('Content-Type')
            .send(Buffer.from('hello'))
        assert.strictEqual(response.statusCode, 415)
    })

    for (const testCase of rejectedEitherCases) {
        it(testCase.name, async () => {
            const response = await request(routeTester)
                .post('/json-or-text-endpoint')
                .set('Content-Type', testCase.contentType)
                .send(testCase.body)
            assert.strictEqual(response.statusCode, 415)
        })
    }
})
