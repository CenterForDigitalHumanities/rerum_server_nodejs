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

/** What the controller last handed to db.aggregate, and how many times, since the mock was installed. */
const searchCalls = { count: 0, pipeline: null }

/** The value a pipeline gives an aggregation operator, e.g. stageOf(pipeline, '$limit'). */
const stageOf = (pipeline, operator) => pipeline.find(stage => operator in stage)?.[operator]

/** Where an operator sits in a pipeline, so the order of the stages can be asserted. */
const positionOf = (pipeline, operator) => pipeline.findIndex(stage => operator in stage)

function mockAggregateResults(docs) {
  // One index means one aggregation per request, so there is a single pipeline to record.
  searchCalls.count = 0
  db.aggregate.mockImplementation((pipeline) => {
    searchCalls.count++
    searchCalls.pipeline = pipeline
    return { toArray: () => Promise.resolve(docs) }
  })
}

/**
 * Answer the search from a fixed, score ordered set of documents, honouring the $skip and $limit
 * the controller put in the pipeline so a walk pages the way Atlas would.
 */
function mockSearchCollection(docs) {
  searchCalls.count = 0
  db.aggregate.mockImplementation((pipeline) => {
    searchCalls.count++
    searchCalls.pipeline = pipeline
    const skip = stageOf(pipeline, '$skip') ?? 0
    const limit = stageOf(pipeline, '$limit') ?? Infinity
    return {
      toArray: () => Promise.resolve(docs.slice(skip, skip + limit).map(doc => structuredClone(doc)))
    }
  })
}

/** A search hit carrying its relevance where the search pipeline puts it. */
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

  it("returns 400 without searching when the JSON body has no searchText string", async () => {
    for (const path of ['/search', '/search/phrase']) {
      for (const body of [{ text: 'line' }, { searchText: 5 }, { searchText: ['line'] }]) {
        mockAggregateResults([])

        const response = await request(routeTester)
          .post(path)
          .set('Content-Type', 'application/json')
          .send(body)

        assert.strictEqual(response.statusCode, 400, `${path} ${JSON.stringify(body)}`)
        assert.strictEqual(searchCalls.count, 0, `${path} ${JSON.stringify(body)} must not reach the database`)
      }
    }
  })

  it("returns 400 without searching when options is not a JSON object", async () => {
    for (const path of ['/search', '/search/phrase']) {
      for (const options of ['x', ['x'], 5]) {
        mockAggregateResults([])

        const response = await request(routeTester)
          .post(path)
          .set('Content-Type', 'application/json')
          .send({ searchText: 'a line', options })

        assert.strictEqual(response.statusCode, 400, `${path} ${JSON.stringify(options)}`)
        assert.strictEqual(searchCalls.count, 0, `${path} ${JSON.stringify(options)} must not reach the database`)
      }
    }
  })

  it("hands a client's options to the phrase operator, and the default slop when there are none", async () => {
    for (const [options, slop] of [[{ slop: 5 }, 5], [null, 2]]) {
      mockAggregateResults([])

      const response = await request(routeTester)
        .post('/search/phrase')
        .set('Content-Type', 'application/json')
        .send({ searchText: 'a line', options })

      assert.strictEqual(response.statusCode, 200, JSON.stringify(options))
      assert.strictEqual(searchCalls.pipeline[0].$search.compound.should[0].phrase.slop, slop)
    }
  })

  it("never lets options replace the searchText or the paths a clause searches", async () => {
    /** The operator document of every should clause, whether it is top level or inside embeddedDocument. */
    const operatorsOf = (pipeline, type) => pipeline[0].$search.compound.should
      .map(clause => (clause.embeddedDocument?.operator ?? clause)[type])
    const search = async (path, options) => {
      mockAggregateResults([])
      const response = await request(routeTester)
        .post(path)
        .set('Content-Type', 'application/json')
        .send({ searchText: 'a line', options })
      assert.strictEqual(response.statusCode, 200, `${path} ${JSON.stringify(options)}`)
      return searchCalls.pipeline
    }

    for (const [path, type] of [['/search', 'text'], ['/search/phrase', 'phrase']]) {
      const expectedPaths = operatorsOf(await search(path, {}), type).map(op => op.path)
      const operators = operatorsOf(await search(path, { query: '', path: 'x', slop: 3 }), type)

      assert.ok(operators.length > 0, path)
      for (const op of operators) assert.strictEqual(op.query, 'a line', `${path} must search the searchText`)
      assert.deepStrictEqual(operators.map(op => op.path), expectedPaths, `${path} must search its own paths`)
      assert.ok(operators.every(op => op.slop === 3), `${path} still applies the client's other options`)
    }
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

  it("searchAsWords runs one search, against the index that covers both vocabularies", async () => {
    mockAggregateResults([])

    const response = await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('shared')

    assert.strictEqual(response.statusCode, 200)
    assert.strictEqual(searchCalls.count, 1)
    assert.strictEqual(searchCalls.pipeline[0].$search.index, 'annotationText')
  })

  it("searches the IIIF 3.0 and IIIF 2.1 text fields in one compound query", async () => {
    mockAggregateResults([])

    await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('line')

    const compound = searchCalls.pipeline[0].$search.compound
    const searched = JSON.stringify(compound.should)
    for (const path of ['body.value', 'bodyValue', 'resource.chars', 'resource.cnt:chars']) {
      assert.ok(searched.includes(path), `${path} must still be searched`)
    }
    assert.strictEqual(compound.minimumShouldMatch, 1, 'any one clause matching qualifies a document')
  })

  it("serves the relevance order the database returned, without resorting it", async () => {
    mockAggregateResults([scoredDoc('best', 83.92), scoredDoc('weak', 1.69), scoredDoc('weaker', 1.24)])

    const response = await request(routeTester)
      .post('/search')
      .set('Content-Type', 'text/plain')
      .send('line')

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(idsOf(response), ['best', 'weak', 'weaker'])
  })

  it("hands skip and limit to the database rather than paging in memory", async () => {
    mockSearchCollection([scoredDoc('a', 9), scoredDoc('b', 5), scoredDoc('c', 3), scoredDoc('d', 2)])
    const page = (queryString) => request(routeTester)
      .post(`/search${queryString}`)
      .set('Content-Type', 'text/plain')
      .send('line')

    assert.deepStrictEqual(idsOf(await page('?limit=2&skip=0')), ['a', 'b'])
    assert.strictEqual(stageOf(searchCalls.pipeline, '$skip'), 0)
    assert.deepStrictEqual(idsOf(await page('?limit=2&skip=2')), ['c', 'd'])
    assert.strictEqual(stageOf(searchCalls.pipeline, '$skip'), 2)
    // limit + 1: the extra record is the only evidence that another page exists.
    assert.strictEqual(stageOf(searchCalls.pipeline, '$limit'), 3)
  })

  it("excludes objects whose _id is not a string, before the page is measured", async () => {
    for (const path of ['/search', '/search/phrase']) {
      mockAggregateResults([])

      await request(routeTester)
        .post(path)
        .set('Content-Type', 'text/plain')
        .send('manuscript')

      const pipeline = searchCalls.pipeline
      assert.deepStrictEqual(stageOf(pipeline, '$match'), { _id: { $type: 'string' } }, path)
      assert.ok(
        positionOf(pipeline, '$match') < positionOf(pipeline, '$limit'),
        `${path} must exclude them before $limit, or the page under-fills`
      )
    }
  })
})

describe('rel="next" links on /search', () => {
  /** The Link header of a response as { rel: url }. */
  const linksOf = (response) => Object.fromEntries(
    [...(response.headers.link ?? '').matchAll(/<([^>]+)>;\s*rel="([^"]+)"/g)].map(([, url, rel]) => [rel, url])
  )

  /** The query string of a link target, which may be absolute or path-only. */
  const paramsOf = (url) => new URL(url, 'http://localhost').searchParams

  const post = (path) => request(routeTester)
    .post(path)
    .set('Content-Type', 'text/plain')
    .send('line')

  const scored = (ids) => ids.map((id, i) => scoredDoc(id, ids.length - i))

  it("links the next page while more records exist, and serves only the page", async () => {
    mockSearchCollection(scored(['a', 'b', 'c']))
    const response = await post('/search?limit=2')
    const links = linksOf(response)

    assert.strictEqual(response.statusCode, 200)
    assert.deepStrictEqual(idsOf(response), ['a', 'b'])
    assert.ok(links.next, 'a next link is present while more records exist')
    assert.strictEqual(paramsOf(links.next).get('limit'), '2')
    assert.strictEqual(paramsOf(links.next).get('skip'), '2')
  })

  it("keeps the JSON-LD context link alongside the next link", async () => {
    mockSearchCollection(scored(['a', 'b', 'c']))
    const links = linksOf(await post('/search?limit=2'))
    assert.ok(links['http://www.w3.org/ns/json-ld#context'])
    assert.ok(links.next)
  })

  it("omits next on the final page", async () => {
    mockSearchCollection(scored(['a', 'b']))
    const response = await post('/search?limit=2')

    assert.deepStrictEqual(idsOf(response), ['a', 'b'])
    assert.deepStrictEqual(
      Object.keys(linksOf(response)),
      ['http://www.w3.org/ns/json-ld#context'],
      'only the JSON-LD context link remains'
    )
  })

  it("never serves the record read past the page, even at the maximum limit", async () => {
    mockSearchCollection(scored(['a']))
    const limitMax = Number((await post('/search?limit=1')).headers['pagination-limit-max'])
    const ids = Array.from({ length: limitMax + 1 }, (_, i) => `id${String(i).padStart(6, '0')}`)
    mockSearchCollection(scored(ids))

    const response = await post(`/search?limit=${limitMax + 100}`)

    assert.strictEqual(response.body.length, limitMax)
    assert.ok(!idsOf(response).includes(ids.at(-1)), 'the extra record must not be served')
    assert.ok(linksOf(response).next)
  })

  it("still links next past the skip maximum, so a walk too deep to finish ends in the 400 that names it", async () => {
    mockSearchCollection(scored(['a']))
    const skipMax = Number((await post('/search?limit=1')).headers['pagination-skip-max'])
    // Every page this double serves has a record past it, however deep the skip.
    db.aggregate.mockImplementation(() => ({
      toArray: () => Promise.resolve(scored(['a', 'b', 'c']))
    }))

    const deepest = await post(`/search?limit=2&skip=${skipMax}`)
    const next = linksOf(deepest).next
    assert.strictEqual(deepest.statusCode, 200)
    assert.strictEqual(
      paramsOf(next).get('skip'),
      String(skipMax + 2),
      'absence would tell the client the walk was complete'
    )

    const beyond = await post(`/search?${paramsOf(next)}`)
    assert.strictEqual(beyond.statusCode, 400)
    assert.strictEqual(beyond.headers['pagination-skip-max'], String(skipMax))
  })

  it("walks every record exactly once by following only rel=\"next\"", async () => {
    const ids = ['d01', 'd02', 'd03', 'd04', 'd05', 'd06', 'd07']
    mockSearchCollection(scored(ids))

    const walked = []
    let path = '/search?limit=3'
    for (let requests = 0; path; requests++) {
      assert.ok(requests < ids.length, 'the walk must terminate')
      const response = await post(path)
      assert.strictEqual(response.statusCode, 200)
      walked.push(...idsOf(response))
      const next = linksOf(response).next
      path = next && `/search?${paramsOf(next)}`
    }

    assert.deepStrictEqual(walked, ids)
  })

  it("links the next page of a phrase search the same way", async () => {
    mockSearchCollection(scored(['a', 'b', 'c']))
    const response = await request(routeTester)
      .post('/search/phrase?limit=2')
      .set('Content-Type', 'text/plain')
      .send('a line')
    const links = linksOf(response)

    assert.deepStrictEqual(idsOf(response), ['a', 'b'])
    assert.ok(links['http://www.w3.org/ns/json-ld#context'])
    assert.strictEqual(paramsOf(links.next).get('skip'), '2')
  })
})

describe('search pagination parameters', () => {
  const searchFor = (path, queryString) => {
    mockAggregateResults([])
    return request(routeTester)
      .post(`${path}${queryString}`)
      .set('Content-Type', 'text/plain')
      .send('manuscript')
  }

  it("searchAsWords rejects a limit or skip it cannot read exactly", async () => {
    for (const queryString of ["?limit=abc", "?skip=-5"]) {
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
