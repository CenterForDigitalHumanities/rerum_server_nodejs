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

  it('persists the same isOverwritten value it returns in the response header', async () => {
    db.findOne.mockResolvedValueOnce(structuredClone(baseObject))
    let captured
    db.replaceOne.mockImplementationOnce(async (filter, replacement) => {
      captured = { filter, replacement }
      return { modifiedCount: 1 }
    })

    const response = await request(routeTester)
      .put('/overwrite')
      .set('Content-Type', 'application/json')
      .send({ '@id': baseObject['@id'], data: 'updated-data' })

    assert.strictEqual(response.statusCode, 200)
    const headerVersion = response.headers['current-overwritten-version']
    assert.ok(headerVersion, 'response must carry a Current-Overwritten-Version header')
    assert.ok(captured, 'db.replaceOne should have been called')
    assert.strictEqual(
      captured.replacement.__rerum.isOverwritten,
      headerVersion,
      'persisted __rerum.isOverwritten must match the value the response advertises'
    )
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
