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

/**
 * Answer the two branches with different documents, so cross-index behavior can be observed.
 *
 * The controllers build the Promise.all array literal presi3 first, and array elements evaluate
 * left to right, so the first queued result is the IIIF 3.0 branch.
 */
function mockBranchResults(presi3Docs, presi2Docs) {
  db.aggregate.mockReturnValueOnce({ toArray: () => Promise.resolve(presi3Docs) })
  db.aggregate.mockReturnValueOnce({ toArray: () => Promise.resolve(presi2Docs) })
}

/** A search hit carrying its relevance where the branch pipelines actually put it. */
const scoredDoc = (id, score) => ({
  _id: id,
  '@id': `https://store.rerum.io/v1/id/${id}`,
  __rerum: { score }
})

/** The document ids of a search response, in the order the endpoint returned them. */
const idsOf = (response) => response.body.map(o => o['@id'].split('/').pop())

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

  // The branch pipelines write relevance to '__rerum.score'.  A comparator reading a top-level
  // 'score' finds nothing on any document, so the merge keeps its construction order and every
  // IIIF 2.1 match is ranked behind every IIIF 3.0 match however well it scores.
  it("searchAsWords ranks across both indexes by score, not by which index answered", async () => {
    mockBranchResults(
      [scoredDoc('presi3-weak', 1.69), scoredDoc('presi3-weaker', 1.24)],
      [scoredDoc('presi2-best', 83.92)]
    )

    const response = await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('line')

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(idsOf(response), ['presi2-best', 'presi3-weak', 'presi3-weaker'])
  })

  it("searchAsPhrase ranks across both indexes too", async () => {
    mockBranchResults([scoredDoc('presi3-weak', 2.45)], [scoredDoc('presi2-best', 6.95)])

    const response = await request(routeTester)
      .post('/search/phrase')
      .set('Content-Type', 'text/plain')
      .send('exact phrase')

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(idsOf(response), ['presi2-best', 'presi3-weak'])
  })

  // The point of the ranking, for this endpoint: 'limit' and 'skip' slice the merged order, so a
  // merge that does not rank hands back a window of the wrong records rather than a wrong order.
  it("pages the score order, so skip walks best-first across both indexes", async () => {
    const branches = () => mockBranchResults(
      [scoredDoc('p3-c', 3), scoredDoc('p3-d', 2)],
      [scoredDoc('p2-a', 9), scoredDoc('p2-b', 5)]
    )
    const page = (queryString) => {
      branches()
      return request(routeTester)
        .post(`/search${queryString}`)
        .set('Content-Type', 'text/plain')
        .send('line')
    }

    assert.deepStrictEqual(idsOf(await page('?limit=2&skip=0')), ['p2-a', 'p2-b'])
    assert.deepStrictEqual(idsOf(await page('?limit=2&skip=2')), ['p3-c', 'p3-d'])
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
