import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import express from 'express'
import request from 'supertest'

import controller from '../../db-controller.js'
import rest from '../../rest.js'
import { db, resetMocks } from '../../database/index.js'

const routeTester = express()
routeTester.use(express.json({ type: ['application/json', 'application/ld+json'] }))
routeTester.use(express.text())
routeTester.post('/search', controller.searchAsWords)
routeTester.post('/search/phrase', controller.searchAsPhrase)
routeTester.use(rest.messenger)

beforeEach(() => {
  resetMocks()
})

function mockAggregateResults(docs) {
  // db.aggregate is called twice (presi3 + presi2 indexes) in parallel; mockReturnValue
  // applies to every call until the next reset.
  db.aggregate.mockReturnValue({
    toArray: () => Promise.resolve(docs)
  })
}

describe('search controllers', () => {
  it("searchAsWords returns 400 when the body is empty", async () => {
    const response = await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('')
    assert.strictEqual(response.statusCode, 400)
  })

  it("searchAsWords returns 200 and an array of results for a text body", async () => {
    const doc = {
      _id: 'doc-1',
      '@id': 'https://store.rerum.io/v1/id/doc-1',
      text: 'matching content'
    }
    mockAggregateResults([doc])

    const response = await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('matching')

    assert.strictEqual(response.statusCode, 200)
    assert.ok(Array.isArray(response.body))
    assert.ok(response.body.length > 0, 'response array should contain results')
    assert.strictEqual(response.body[0]['@id'], doc['@id'])
  })

  it("searchAsPhrase returns 400 when the body is empty", async () => {
    const response = await request(routeTester)
      .post('/search/phrase')
      .set('Content-Type', 'text/plain')
      .send('')
    assert.strictEqual(response.statusCode, 400)
  })

  it("searchAsPhrase returns 200 and an array of results for a text body", async () => {
    const doc = {
      _id: 'doc-2',
      '@id': 'https://store.rerum.io/v1/id/doc-2',
      text: 'phrase content'
    }
    mockAggregateResults([doc])

    const response = await request(routeTester)
      .post('/search/phrase')
      .set('Content-Type', 'text/plain')
      .send('exact phrase')

    assert.strictEqual(response.statusCode, 200)
    assert.ok(Array.isArray(response.body))
    assert.ok(response.body.length > 0)
    assert.strictEqual(response.body[0]['@id'], doc['@id'])
  })

  // The two parallel db.aggregate calls (presi3 + presi2) can return overlapping documents.
  // mergeSearchResults must dedupe by _id; a regression that drops the dedupe would return
  // duplicates here.
  it("searchAsWords dedupes when both indexes return the same document", async () => {
    const doc = {
      _id: 'shared-doc',
      '@id': 'https://store.rerum.io/v1/id/shared-doc',
      text: 'shared'
    }
    mockAggregateResults([doc])

    const response = await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('shared')

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.body.length, 1, 'duplicate _id across indexes should be deduped')
  })
})

describe('search pagination parameters', () => {
  // getPagination is shared with /query, so this proves the search endpoints are covered by the
  // same contract rather than re-testing every rejected form here.
  const searchFor = (path, queryString) => {
    mockAggregateResults([])
    return request(routeTester)
      .post(`${path}${queryString}`)
      .set('Content-Type', 'text/plain')
      .send('manuscript')
  }

  it("searchAsWords rejects a limit or skip it cannot read exactly", async () => {
    for (const queryString of ["?limit=abc", "?limit=1e3", "?limit=0", "?skip=-5", "?limit=100&limit=200"]) {
      const response = await searchFor('/search', queryString)
      assert.strictEqual(response.statusCode, 400, `${queryString} should be a 400`)
    }
  })

  it("searchAsPhrase rejects them too", async () => {
    const response = await searchFor('/search/phrase', '?skip=2.9')
    assert.strictEqual(response.statusCode, 400)
  })

  it("reports the applied limit and skip on a search response", async () => {
    const response = await searchFor('/search', '?limit=25&skip=10')
    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(response.headers['pagination-limit'], '25')
    assert.strictEqual(response.headers['pagination-skip'], '10')
    assert.ok(Number(response.headers['pagination-limit-max']) > 0)
    assert.ok(Number(response.headers['pagination-skip-max']) > 0)
  })
})
