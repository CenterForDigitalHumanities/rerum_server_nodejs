import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import request from 'supertest'

import app from '../app.js'

const mountedTopLevelRoutes = [
  { name: '/v1', method: 'get', path: '/v1', expectedStatus: 301 },
  { name: '/client/register', method: 'get', path: '/client/register', expectedStatus: 200 },
  { name: '/v1/id/{_id}', method: 'get', path: '/v1/id/test-mounted-id', expectedStatus: 404 },
  { name: '/v1/since/{_id}', method: 'get', path: '/v1/since/test-mounted-id', expectedStatus: 404 },
  { name: '/v1/history/{_id}', method: 'get', path: '/v1/history/test-mounted-id', expectedStatus: 404 }
]

const mountedApiRoutes = [
  { name: '/v1/api/query', method: 'post', path: '/v1/api/query', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/create', method: 'post', path: '/v1/api/create', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/bulkCreate', method: 'post', path: '/v1/api/bulkCreate', headers: { 'Content-Type': 'application/json' }, body: [{ mounted: true }] },
  { name: '/v1/api/update', method: 'put', path: '/v1/api/update', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/bulkUpdate', method: 'put', path: '/v1/api/bulkUpdate', headers: { 'Content-Type': 'application/json' }, body: [{ mounted: true }] },
  { name: '/v1/api/overwrite', method: 'put', path: '/v1/api/overwrite', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/patch', method: 'patch', path: '/v1/api/patch', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/set', method: 'patch', path: '/v1/api/set', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/unset', method: 'patch', path: '/v1/api/unset', headers: { 'Content-Type': 'application/json' }, body: { mounted: true } },
  { name: '/v1/api/delete/{id}', method: 'delete', path: '/v1/api/delete/test-mounted-id' },
  { name: '/v1/api/release/{id}', method: 'patch', path: '/v1/api/release/test-mounted-id' },
  { name: '/v1/api/search', method: 'post', path: '/v1/api/search', headers: { 'Content-Type': 'text/plain' }, body: 'mounted search' },
  { name: '/v1/api/search/phrase', method: 'post', path: '/v1/api/search/phrase', headers: { 'Content-Type': 'text/plain' }, body: 'mounted phrase search' }
]

describe('Mounted route surface', () => {
  for (const route of mountedTopLevelRoutes) {
    it(`${route.name} is mounted`, async () => {
      const response = await request(app)[route.method](route.path)
      assert.strictEqual(response.statusCode, route.expectedStatus)
    })
  }

  for (const route of mountedApiRoutes) {
    it(`${route.name} is mounted`, async () => {
      let pending = request(app)[route.method](route.path)
      for (const [headerName, headerValue] of Object.entries(route.headers ?? {})) {
        pending = pending.set(headerName, headerValue)
      }
      if (route.body !== undefined) {
        pending = pending.send(route.body)
      }
      const response = await pending
      assert.notStrictEqual(response.statusCode, 404)
    })
  }
})

describe('Auth pipeline', () => {
  // Build a structurally valid JWT with alg:HS256 and an agent claim. The downstream
  // _extractUser would happily decode this; only the real auth() middleware rejects
  // it for the wrong algorithm (default config is RS256-only). A no-op stand-in for
  // auth() would let the request reach the controller and succeed.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    sub: 'auth-pipeline-test',
    'http://store.rerum.io/agent': 'https://store.rerum.io/v1/id/non-bot-agent'
  })).toString('base64url')
  const fakeJwt = `${header}.${payload}.fakesignature`

  it('rejects an HS256-signed token (auth() enforces RS256)', async () => {
    const response = await request(app)
      .post('/v1/api/create')
      .set('Authorization', `Bearer ${fakeJwt}`)
      .set('Content-Type', 'application/json')
      .send({ test: 'value' })
    assert.strictEqual(response.statusCode, 401)
  })
})

describe('Body parser limits', () => {
  it('returns 413 when a JSON body exceeds the 5 MB limit', async () => {
    // 6 MB of payload + JSON framing pushes the request body well above the 5 MB limit set in app.js.
    const oversizePayload = { content: 'a'.repeat(6 * 1024 * 1024) }
    const response = await request(app)
      .post('/v1/api/create')
      .set('Content-Type', 'application/json')
      .send(oversizePayload)
    assert.strictEqual(response.statusCode, 413)
  })

  it('returns 413 when a text body exceeds the 4 KB limit on /api/search', async () => {
    const oversizeText = 'a'.repeat(5000)
    const response = await request(app)
      .post('/v1/api/search')
      .set('Content-Type', 'text/plain')
      .send(oversizeText)
    assert.strictEqual(response.statusCode, 413)
  })
})

describe('Critical project assets', () => {
  it('keeps required public files in place', () => {
    const requiredPublicFiles = [
      'stylesheets/api.css',
      'stylesheets/style.css',
      'index.html',
      'API.html',
      'context.json',
      'maintenance.html',
      'terms.txt'
    ]

    for (const filePath of requiredPublicFiles) {
      assert.ok(fs.existsSync(`./public/${filePath}`), `Missing ./public/${filePath}`)
    }
  })

  it('keeps required repository files in place', () => {
    const requiredRepoFiles = [
      'CODEOWNERS',
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'README.md',
      'LICENSE',
      '.gitignore',
      'package.json'
    ]

    for (const filePath of requiredRepoFiles) {
      assert.ok(fs.existsSync(`./${filePath}`), `Missing ./${filePath}`)
    }
  })
})
