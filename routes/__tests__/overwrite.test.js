import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'

import controller from '../../db-controller.js'
import { db, resetMocks } from '../../database/index.js'

const addAuth = (req, res, next) => {
  req.user = { 'http://store.rerum.io/agent': 'test-user' }
  next()
}

const routeTester = express()
routeTester.use(express.json({ type: ['application/json', 'application/ld+json'] }))
routeTester.put('/overwrite', addAuth, controller.overwrite)
routeTester.get('/id/:_id', controller.id)

const baseObject = {
  _id: 'test-id',
  '@id': 'http://example.com/test-id',
  '@context': 'http://example.com/context',
  __rerum: {
    isOverwritten: '',
    generatedBy: 'test-user',
    history: { prime: 'root', previous: '', next: [] },
    releases: { previous: '', next: [], replaces: '' },
    isReleased: ''
  },
  data: 'original-data'
}

beforeEach(() => {
  resetMocks()
})

describe('overwrite route', () => {
  it('supports overwrite without an optimistic-lock version', async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(baseObject))

    const response = await request(routeTester)
      .put('/overwrite')
      .set('Content-Type', 'application/json')
      .send({ '@id': baseObject['@id'], data: 'updated-data' })

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.data, 'updated-data')
    assert.ok(response.headers['current-overwritten-version'])
    assert.strictEqual(response.body._id, undefined)
  })

  it('accepts the If-Overwritten-Version header when it matches the current version', async () => {
    const originalObject = structuredClone(baseObject)
    originalObject.__rerum.isOverwritten = '2025-06-24T10:00:00'
    db.findOne.mockResolvedValueOnce(originalObject)

    const response = await request(routeTester)
      .put('/overwrite')
      .set('Content-Type', 'application/json')
      .set('If-Overwritten-Version', '2025-06-24T10:00:00')
      .send({ '@id': baseObject['@id'], data: 'updated-data' })

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.data, 'updated-data')
    assert.ok(response.headers['current-overwritten-version'])
  })

  it('accepts the request body overwrite version as a fallback', async () => {
    const originalObject = structuredClone(baseObject)
    originalObject.__rerum.isOverwritten = '2025-06-24T10:00:00'
    db.findOne.mockResolvedValueOnce(originalObject)

    const response = await request(routeTester)
      .put('/overwrite')
      .set('Content-Type', 'application/json')
      .send({
        '@id': baseObject['@id'],
        data: 'updated-data',
        __rerum: { isOverwritten: '2025-06-24T10:00:00' }
      })

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.data, 'updated-data')
  })

  it('returns 409 when the optimistic-lock version mismatches', async () => {
    const originalObject = structuredClone(baseObject)
    originalObject.__rerum.isOverwritten = '2025-06-24T10:30:00'
    db.findOne.mockResolvedValueOnce(originalObject)

    const response = await request(routeTester)
      .put('/overwrite')
      .set('Content-Type', 'application/json')
      .set('If-Overwritten-Version', '2025-06-24T10:00:00')
      .send({ '@id': baseObject['@id'], data: 'updated-data' })

    assert.strictEqual(response.statusCode, 409)
    assert.strictEqual(response.body.currentVersion.__rerum.isOverwritten, '2025-06-24T10:30:00')
  })
})

describe('id route overwrite headers', () => {
  it('includes the current overwrite version header for existing objects', async () => {
    const originalObject = structuredClone(baseObject)
    originalObject.__rerum.isOverwritten = '2025-06-24T10:00:00'
    db.findOne.mockResolvedValueOnce(originalObject)

    const response = await request(routeTester).get('/id/test-id')

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['current-overwritten-version'], '2025-06-24T10:00:00')
  })

  it('uses an empty overwrite version header for never-overwritten objects', async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(baseObject))

    const response = await request(routeTester).get('/id/test-id')

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['current-overwritten-version'], '')
  })
})
