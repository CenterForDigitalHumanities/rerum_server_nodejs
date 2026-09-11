import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import utils from '../utils.js'
import {
  generateSlugId,
  getAllVersions,
  alterHistoryNext,
  parseDocumentID,
  _contextid,
  idNegotiation,
  getPagination,
  findLeafAnnotationsFor
} from '../controllers/utils.js'
import { db, resetMocks, createCursor } from '../database/index.js'

describe('utils.js auth gates', () => {
  it('isDeleted returns true only for objects with __deleted', () => {
    assert.strictEqual(utils.isDeleted({}), false)
    assert.strictEqual(utils.isDeleted({ data: 'live' }), false)
    assert.strictEqual(utils.isDeleted({ __deleted: { time: '2024-01-01' } }), true)
  })

  it('isReleased returns true only when __rerum.isReleased is non-empty', () => {
    assert.strictEqual(utils.isReleased({}), false)
    assert.strictEqual(utils.isReleased({ __rerum: {} }), false)
    assert.strictEqual(utils.isReleased({ __rerum: { isReleased: '' } }), false)
    assert.strictEqual(utils.isReleased({ __rerum: { isReleased: '2024-01-01' } }), true)
  })

  it('isGenerator returns true only when the agent matches __rerum.generatedBy', () => {
    assert.strictEqual(
      utils.isGenerator({ __rerum: { generatedBy: 'alice' } }, 'alice'),
      true
    )
    assert.strictEqual(
      utils.isGenerator({ __rerum: { generatedBy: 'alice' } }, 'bob'),
      false
    )
  })
})

describe('utils.js configureRerumOptions', () => {
  it('overwrites user-supplied __rerum.generatedBy with the passed-in generator (no attribution forgery)', () => {
    const result = utils.configureRerumOptions(
      'https://store.rerum.io/v1/id/legitimate-agent',
      { __rerum: { generatedBy: 'https://attacker.example/forged' } },
      false,
      false
    )
    assert.strictEqual(result.__rerum.generatedBy, 'https://store.rerum.io/v1/id/legitimate-agent')
  })

  const AGENT = 'https://store.rerum.io/v1/id/legitimate-agent'
  const RECEIVED_ID = 'https://store.rerum.io/v1/id/received-id'
  const FORGED = {
    generatedBy: 'https://attacker.example/forged',
    isReleased: '2020-01-01T00:00:00.000',
    isOverwritten: '2020-01-01T00:00:00.000',
    history: { prime: 'https://store.rerum.io/v1/id/forged-prime', previous: 'https://store.rerum.io/v1/id/forged-previous', next: ['https://store.rerum.io/v1/id/forged-next'] },
    releases: { previous: 'https://store.rerum.io/v1/id/forged-release', next: [], replaces: '' }
  }

  it('ignores a client-supplied __rerum when minting a new object', () => {
    const created = utils.configureRerumOptions(AGENT, { '@id': RECEIVED_ID, __rerum: structuredClone(FORGED) }, false, false)
    assert.strictEqual(created.__rerum.history.prime, 'root')
    assert.strictEqual(created.__rerum.history.previous, '')
    assert.deepStrictEqual(created.__rerum.history.next, [])
    assert.strictEqual(created.__rerum.releases.previous, '')
    // isReleased gates release and overwrite, isOverwritten is the optimistic locking token.
    assert.strictEqual(created.__rerum.generatedBy, AGENT, 'attribution cannot be forged')
    assert.strictEqual(created.__rerum.isReleased, '', 'a client cannot mint a pre-released object')
    assert.strictEqual(created.__rerum.isOverwritten, '', 'a client cannot mint a locking token')

    // An external object imported through an update is also a root, but it remembers its external self.
    const imported = utils.configureRerumOptions(AGENT, { '@id': 'https://elsewhere.example.org/thing', __rerum: structuredClone(FORGED) }, false, true)
    assert.strictEqual(imported.__rerum.history.prime, 'root')
    assert.strictEqual(imported.__rerum.history.previous, 'https://elsewhere.example.org/thing')
    assert.strictEqual(imported.__rerum.releases.previous, '')
  })

  it('carries the version and release chain forward when updating an existing object', () => {
    const fromRoot = utils.configureRerumOptions(
      AGENT,
      { '@id': RECEIVED_ID, __rerum: { history: { prime: 'root', previous: '', next: [] } } },
      true,
      false
    )
    assert.strictEqual(fromRoot.__rerum.history.prime, RECEIVED_ID, 'the root object cannot pass "root" on as the prime')
    assert.strictEqual(fromRoot.__rerum.history.previous, RECEIVED_ID)

    const PRIME = 'https://store.rerum.io/v1/id/prime-id'
    const RELEASE = 'https://store.rerum.io/v1/id/released-id'
    const fromDescendant = utils.configureRerumOptions(
      AGENT,
      {
        '@id': RECEIVED_ID,
        __rerum: {
          history: { prime: PRIME, previous: 'https://store.rerum.io/v1/id/older-id', next: [] },
          releases: { previous: RELEASE, next: [], replaces: '' }
        }
      },
      true,
      false
    )
    assert.strictEqual(fromDescendant.__rerum.history.prime, PRIME, 'an object that knows its prime passes it on')
    assert.strictEqual(fromDescendant.__rerum.history.previous, RECEIVED_ID)
    assert.strictEqual(fromDescendant.__rerum.releases.previous, RELEASE)
  })
})

describe('controllers/utils.js generateSlugId', () => {
  it('returns code 11000 when the proposed slug already exists', async () => {
    resetMocks()
    db.findOne.mockResolvedValueOnce({ _id: 'taken-slug' })
    const result = await generateSlugId('taken-slug', () => {})
    assert.strictEqual(result.code, 11000)
    assert.strictEqual(result.slug_id, 'taken-slug')
  })

  it('returns code 0 when the proposed slug is free', async () => {
    resetMocks()
    db.findOne.mockResolvedValueOnce(null)
    const result = await generateSlugId('free-slug', () => {})
    assert.strictEqual(result.code, 0)
    assert.strictEqual(result.slug_id, 'free-slug')
  })
})

describe('controllers/utils.js getAllVersions', () => {
  const ROOT_ID = 'https://store.rerum.io/v1/id/root-id'
  const V1_ID = 'https://store.rerum.io/v1/id/v1-id'

  const rootObj = {
    _id: 'root-id',
    '@id': ROOT_ID,
    __rerum: { history: { prime: 'root', previous: '', next: [V1_ID] } }
  }
  const v1Obj = {
    _id: 'v1-id',
    '@id': V1_ID,
    __rerum: { history: { prime: ROOT_ID, previous: ROOT_ID, next: [] } }
  }

  it('returns [root, ...descendants] when given a root object directly', async () => {
    resetMocks()
    db.find.mockReturnValueOnce({ toArray: () => Promise.resolve([v1Obj]) })

    const result = await getAllVersions(rootObj)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0]['@id'], ROOT_ID)
    assert.strictEqual(result[1]['@id'], V1_ID)
  })

  it('fetches the root from the database when given a non-root object', async () => {
    resetMocks()
    db.findOne.mockResolvedValueOnce(rootObj)
    db.find.mockReturnValueOnce({ toArray: () => Promise.resolve([v1Obj]) })

    const result = await getAllVersions(v1Obj)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0]['@id'], ROOT_ID, 'root must be first')
    assert.strictEqual(result[1]['@id'], V1_ID)
  })

  it('throws when the root object cannot be found in the database', async () => {
    resetMocks()
    db.findOne.mockResolvedValueOnce(null)
    const orphan = {
      _id: 'orphan-id',
      __rerum: { history: { prime: 'https://store.rerum.io/v1/id/missing-root', previous: '', next: [] } }
    }
    await assert.rejects(() => getAllVersions(orphan), /not found/)
  })
})

describe('controllers/utils.js alterHistoryNext', () => {
  it('appends newNextID to history.next and persists via db.replaceOne', async () => {
    resetMocks()
    const obj = {
      _id: 'parent-id',
      '@id': 'https://store.rerum.io/v1/id/parent-id',
      __rerum: { history: { prime: 'root', previous: '', next: [] } }
    }
    const newNextID = 'https://store.rerum.io/v1/id/child-id'
    let captured
    db.replaceOne.mockImplementationOnce(async (filter, replacement) => {
      captured = { filter, replacement }
      return { modifiedCount: 1 }
    })

    const result = await alterHistoryNext(obj, newNextID)

    assert.strictEqual(result, true)
    assert.deepStrictEqual(obj.__rerum.history.next, [newNextID])
    assert.ok(captured, 'db.replaceOne must be called')
    assert.deepStrictEqual(captured.filter, { _id: 'parent-id' })
    assert.ok(captured.replacement.__rerum.history.next.includes(newNextID))
  })

  it('does NOT call db.replaceOne when newNextID is already in history.next', async () => {
    resetMocks()
    const existingID = 'https://store.rerum.io/v1/id/already-linked'
    const obj = {
      _id: 'parent-id',
      __rerum: { history: { prime: 'root', previous: '', next: [existingID] } }
    }
    let replaceOneCalled = false
    db.replaceOne.mockImplementationOnce(async () => {
      replaceOneCalled = true
      return { modifiedCount: 1 }
    })

    const result = await alterHistoryNext(obj, existingID)

    assert.strictEqual(result, true)
    assert.strictEqual(replaceOneCalled, false, 'db.replaceOne should NOT be called for an existing link')
    assert.deepStrictEqual(obj.__rerum.history.next, [existingID], 'history.next should not be duplicated')
  })

  it('returns false when db.replaceOne reports modifiedCount === 0', async () => {
    resetMocks()
    const obj = {
      _id: 'parent-id',
      __rerum: { history: { prime: 'root', previous: '', next: [] } }
    }
    db.replaceOne.mockResolvedValueOnce({ modifiedCount: 0 })

    const result = await alterHistoryNext(obj, 'https://store.rerum.io/v1/id/new-child')

    assert.strictEqual(result, false)
  })
})

describe('controllers/utils.js parseDocumentID', () => {
  it('returns the last URL segment for an http(s) URL', () => {
    assert.strictEqual(parseDocumentID('https://store.rerum.io/v1/id/abc123'), 'abc123')
    assert.strictEqual(parseDocumentID('http://example.com/id/xyz'), 'xyz')
  })

  it('throws on non-string input', () => {
    assert.throws(() => parseDocumentID(123), /Unable to parse/)
    assert.throws(() => parseDocumentID(null), /Unable to parse/)
    assert.throws(() => parseDocumentID({}), /Unable to parse/)
  })

  it('throws on non-URL strings', () => {
    assert.throws(() => parseDocumentID('not-a-url'), /URL strings/)
    assert.throws(() => parseDocumentID('ftp://example.com/id'), /URL strings/)
  })
})

describe('controllers/utils.js _contextid', () => {
  it('returns true for known JSON-LD contexts', () => {
    assert.strictEqual(_contextid('https://store.rerum.io/v1/context.json'), true)
    assert.strictEqual(_contextid('http://iiif.io/api/presentation/3/context.json'), true)
    assert.strictEqual(_contextid('http://www.w3.org/ns/anno.jsonld'), true)
    assert.strictEqual(_contextid('http://www.w3.org/ns/oa.jsonld'), true)
  })

  it('returns false for unknown contexts', () => {
    assert.strictEqual(_contextid('http://example.com/random/context.json'), false)
    assert.strictEqual(_contextid(''), false)
  })

  it('returns true when an array of contexts contains a known one', () => {
    assert.strictEqual(
      _contextid(['http://example.com/other', 'http://iiif.io/api/presentation/3/context.json']),
      true
    )
    // An inline term definition object, or any other non-string member, names no context.
    assert.strictEqual(
      _contextid([{ '@vocab': 'http://example.org/terms#' }, 'http://www.w3.org/ns/anno.jsonld']),
      true
    )
    assert.strictEqual(_contextid([{ '@vocab': 'http://example.org/terms#' }]), false)
  })

  it('returns false for non-string, non-array input', () => {
    assert.strictEqual(_contextid(null), false)
    assert.strictEqual(_contextid(123), false)
    assert.strictEqual(_contextid({}), false)
  })
})

describe('controllers/utils.js idNegotiation edge cases', () => {
  it('returns undefined for falsy input', () => {
    assert.strictEqual(idNegotiation(undefined), undefined)
    assert.strictEqual(idNegotiation(null), undefined)
  })

  it('strips _id and returns the body unchanged when there is no @context', () => {
    const obj = { _id: 'abc', foo: 'bar' }
    const result = idNegotiation(obj)
    assert.strictEqual(result._id, undefined)
    assert.strictEqual(result.foo, 'bar')
  })

  it('strips @id and projects it onto `id` when @context is a known JSON-LD context', () => {
    const result = idNegotiation({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      _id: 'example',
      '@id': `${process.env.RERUM_ID_PREFIX}example`,
      test: 'item'
    })
    assert.strictEqual(result._id, undefined)
    assert.strictEqual(result['@id'], undefined)
    assert.strictEqual(result.id, `${process.env.RERUM_ID_PREFIX}example`)
    assert.strictEqual(result.test, 'item')
  })

  it('keeps @id and preserves an existing `id` field when @context is unknown', () => {
    const result = idNegotiation({
      '@context': 'http://example.org/context.json',
      _id: 'example',
      '@id': `${process.env.RERUM_ID_PREFIX}example`,
      id: 'test_example',
      test: 'item'
    })
    assert.strictEqual(result._id, undefined)
    assert.strictEqual(result['@id'], `${process.env.RERUM_ID_PREFIX}example`)
    assert.strictEqual(result.id, 'test_example')
    assert.strictEqual(result.test, 'item')
  })
})

describe('controllers/utils.js getPagination', () => {
  /** Assert that a query is rejected as a 400 rather than guessed at. */
  const assertRejects = (query, matcher) => {
    assert.throws(
      () => getPagination(query),
      (err) => {
        assert.strictEqual(err.statusCode, 400)
        assert.match(err.statusMessage, matcher)
        return true
      },
      `${JSON.stringify(query)} should be rejected`
    )
  }

  it('returns the default limit and skip 0 for an empty query', () => {
    const result = getPagination({}, null, 100)
    assert.strictEqual(result.limit, 100)
    assert.strictEqual(result.skip, 0)
  })

  it('parses decimal integer string values from the query', () => {
    const result = getPagination({ limit: '50', skip: '10' })
    assert.strictEqual(result.limit, 50)
    assert.strictEqual(result.skip, 10)
  })

  it('rejects a limit that is not a whole number greater than 0', () => {
    for (const limit of ['abc', '10abc', '1e3', '0x10', '250.7', '-5', '', '0']) {
      assertRejects({ limit }, /'limit' URL parameter must be a whole number greater than 0/)
    }
  })

  it('rejects a skip that is not a whole number of 0 or greater', () => {
    for (const skip of ['abc', '10abc', '1e3', '0x10', '2.9', '-5', '']) {
      assertRejects({ skip }, /'skip' URL parameter must be a whole number 0 or greater/)
    }
  })

  it('accepts skip 0, which limit does not', () => {
    assert.strictEqual(getPagination({ skip: '0' }).skip, 0)
    assertRejects({ limit: '0' }, /whole number greater than 0/)
  })

  it('rejects a repeated parameter rather than taking a guess at which one was meant', () => {
    // Express hands a repeated URL parameter over as an Array.  '?limit=100&limit=200' has no
    // single correct reading.
    assertRejects({ limit: ['100', '200'] }, /'limit' URL parameter was provided more than once/)
    assertRejects({ skip: ['1', '2'] }, /'skip' URL parameter was provided more than once/)
  })

  it('truncates a long rejected value rather than reflecting all of it back', () => {
    assert.throws(
      () => getPagination({ limit: 'x'.repeat(500) }),
      (err) => err.statusMessage.length < 200
    )
  })

  it('clamps a limit above the maximum instead of rejecting it', () => {
    const { limit } = getPagination({ limit: String(Number.MAX_SAFE_INTEGER) })
    const { 'Pagination-Limit-Max': max } = capturedHeadersFor({})
    assert.strictEqual(limit, Number(max))
  })

  it('rejects a skip above the maximum rather than serving the same page forever', () => {
    // Clamping it would hand back the page at the maximum on every request past it.  A client
    // advancing skip and stopping on an empty page would never terminate.
    const max = Number(capturedHeadersFor({})['Pagination-Skip-Max'])
    assertRejects({ skip: String(max + 1) }, /beyond the maximum/)
    assertRejects({ skip: String(max + 50000) }, /beyond the maximum/)
  })

  it('names the configured maximum in the rejection, so a client can act on it', () => {
    const original = process.env.MAX_QUERY_SKIP
    try {
      process.env.MAX_QUERY_SKIP = '2500'
      assertRejects({ skip: '2501' }, /2501 is beyond the maximum of 2500/)
      assert.strictEqual(getPagination({ skip: '2500' }).skip, 2500)
    } finally {
      if (original === undefined) delete process.env.MAX_QUERY_SKIP
      else process.env.MAX_QUERY_SKIP = original
    }
  })

  it('accepts a skip exactly at the maximum', () => {
    const max = Number(capturedHeadersFor({})['Pagination-Skip-Max'])
    assert.strictEqual(getPagination({ skip: String(max) }).skip, max)
  })

  it('reports the applied values and the maximums on every paged response', () => {
    const headers = capturedHeadersFor({ limit: '25', skip: '10' })
    assert.strictEqual(headers['Pagination-Limit'], '25')
    assert.strictEqual(headers['Pagination-Skip'], '10')
    assert.ok(Number(headers['Pagination-Limit-Max']) > 0)
    assert.ok(Number(headers['Pagination-Skip-Max']) > 0)
  })

  it('reports the clamped limit, not the one that was asked for', () => {
    const headers = capturedHeadersFor({ limit: '999999' })
    assert.strictEqual(headers['Pagination-Limit'], headers['Pagination-Limit-Max'])
  })

  it('reads the caps from the environment at call time', () => {
    // Captured at module load these would be unreadable, which is how the RERUM_MAX_QUERY_* /
    // MAX_QUERY_* name mismatch went unnoticed.
    const original = process.env.MAX_QUERY_LIMIT
    try {
      process.env.MAX_QUERY_LIMIT = '25'
      const { limit } = getPagination({ limit: '100' })
      assert.strictEqual(limit, 25)
      assert.strictEqual(capturedHeadersFor({})['Pagination-Limit-Max'], '25')
    } finally {
      if (original === undefined) delete process.env.MAX_QUERY_LIMIT
      else process.env.MAX_QUERY_LIMIT = original
    }
  })

  it('falls back to the code default when a configured cap is unusable', () => {
    // '1e3' and '100_000' are what a hand-typed six figure cap looks like.  Parsed rather than
    // validated they become 1, which would serve one record per page across the deployment.
    const original = process.env.MAX_QUERY_LIMIT
    try {
      for (const configured of ['not-a-number', '1e3', '100_000', '500abc', '250.7', '0', '-5', ' 500']) {
        process.env.MAX_QUERY_LIMIT = configured
        assert.strictEqual(
          capturedHeadersFor({})['Pagination-Limit-Max'],
          '500',
          `MAX_QUERY_LIMIT='${configured}' should fall back to the code default`
        )
      }
    } finally {
      if (original === undefined) delete process.env.MAX_QUERY_LIMIT
      else process.env.MAX_QUERY_LIMIT = original
    }
  })

  it('reports the ceilings on a rejection, so a client can recover from the 400 it just got', () => {
    // The 400 for an over-deep skip is the response a client most needs the ceiling from, and it
    // is what lets a paged walk tell that boundary apart from every other 400 it could receive.
    for (const query of [{ limit: 'abc' }, { skip: 'abc' }, { limit: ['100', '200'] }, { skip: '999999999' }]) {
      const headers = capturedHeadersFor(query)
      assert.ok(Number(headers['Pagination-Limit-Max']) > 0, `${JSON.stringify(query)} should still report the limit ceiling`)
      assert.ok(Number(headers['Pagination-Skip-Max']) > 0, `${JSON.stringify(query)} should still report the skip ceiling`)
    }
  })

  it('reports no applied page on a rejection, because none was served', () => {
    const headers = capturedHeadersFor({ skip: '999999999' })
    assert.strictEqual(headers['Pagination-Limit'], undefined)
    assert.strictEqual(headers['Pagination-Skip'], undefined)
  })

  it('accepts an already-integral number, which req.query never holds but a caller might pass', () => {
    const result = getPagination({ limit: 50, skip: 10 })
    assert.strictEqual(result.limit, 50)
    assert.strictEqual(result.skip, 10)
    assertRejects({ limit: 250.7 }, /whole number greater than 0/)
  })

  it('reports nothing rather than throwing when the second argument cannot set headers', () => {
    // The pre-existing shape was getPagination(query, defaultLimit).  A caller still using it would
    // otherwise get a TypeError out of the header reporting, which surfaces as a 500 on an endpoint
    // that meant to answer 200.
    for (const notAResponse of [100, 'res', true, {}, { set: 'not a function' }]) {
      const result = getPagination({ limit: '25', skip: '5' }, notAResponse)
      assert.strictEqual(result.limit, 25, `${JSON.stringify(notAResponse)} should not change the limit`)
      assert.strictEqual(result.skip, 5, `${JSON.stringify(notAResponse)} should not change the skip`)
    }
  })

  it('echoes the raw skip in the ceiling rejection, not the value it parsed to', () => {
    // A digit string long enough to lose precision parses to a different number than the client
    // sent, and a message naming a value nobody asked for cannot be matched back to its request.
    const raw = '99999999999999999999'
    assert.throws(
      () => getPagination({ skip: raw }),
      (err) => {
        assert.strictEqual(err.statusCode, 400)
        assert.match(err.statusMessage, new RegExp(`of ${raw} is beyond the maximum`))
        return true
      }
    )
  })

  /**
   * Run getPagination against a minimal response double and hand back the headers it set.
   *
   * The ceilings and the applied values arrive as two separate set() calls, so they are merged
   * rather than overwritten.  A rejected query still reports the ceilings, so a 400 is caught here
   * instead of propagating.  Anything else still throws, so a real fault is not swallowed.
   */
  function capturedHeadersFor(query) {
    const captured = {}
    try {
      getPagination(query, { set: (headers) => Object.assign(captured, headers) })
    } catch (err) {
      if (err.statusCode !== 400) throw err
    }
    return captured
  }
})

describe('controllers/utils.js findLeafAnnotationsFor', () => {
  const ENTITY_URI = 'https://store.rerum.io/v1/id/entity-id'
  const SLUG_URI = 'https://store.rerum.io/v1/id/entity-slug'
  const TARGET_KEYS = ['target', 'target.@id', 'target.id', 'target.source', 'target.source.@id', 'target.source.id']

  let capturedQuery

  /**
   * Point db.find() at a cursor over the given documents and record the filter it was called with.
   *
   * @param docs The Annotation documents the cursor will yield.
   */
  function armFind(docs = []) {
    resetMocks()
    capturedQuery = undefined
    db.find.mockImplementationOnce(query => {
      capturedQuery = query
      return createCursor(docs)
    })
  }

  // $and[0] holds the target conditions, $and[1] the Annotation type conditions.
  const targetConditions = () => capturedQuery.$and[0].$or

  it('constrains the query to the leaf versions, every target key, and every type spelling', async () => {
    armFind()

    await findLeafAnnotationsFor([ENTITY_URI, SLUG_URI, ENTITY_URI, undefined, ''])

    assert.deepStrictEqual(capturedQuery['__rerum.history.next'], { $exists: true, $size: 0 })
    for (const targetKey of TARGET_KEYS) {
      const values = targetConditions()
        .filter(condition => Object.hasOwn(condition, targetKey))
        .map(condition => condition[targetKey])
      assert.strictEqual(values.length, 8, `${targetKey}: two URIs, each in two schemes and as a fragment`)
      assert.ok(values.includes(ENTITY_URI) && values.includes(ENTITY_URI.replace(/^https/, 'http')))
      assert.ok(values.includes(SLUG_URI), 'every URI the entity answers to is targeted')
      const patterns = values.filter(value => value instanceof RegExp)
      assert.ok(patterns.some(pattern => pattern.test(`${ENTITY_URI}#xywh=0,0,100,100`)), 'a fragment of the URI is a match')
      assert.ok(
        patterns.every(pattern => !pattern.test('https://storeXrerum.io/v1/id/entity-id#xywh=0,0,100,100')),
        'the URI is escaped, so its dots are not wildcards'
      )
    }
    assert.deepStrictEqual(capturedQuery.$and[1].$or, [
      { type: 'Annotation' },
      { type: 'oa:Annotation' },
      { type: 'http://www.w3.org/ns/oa#Annotation' },
      { type: 'https://www.w3.org/ns/oa#Annotation' },
      { '@type': 'Annotation' },
      { '@type': 'oa:Annotation' },
      { '@type': 'http://www.w3.org/ns/oa#Annotation' },
      { '@type': 'https://www.w3.org/ns/oa#Annotation' }
    ])

    armFind()
    await findLeafAnnotationsFor('bare-slug')
    assert.strictEqual(targetConditions().length, TARGET_KEYS.length, 'a non-URI target has no scheme or fragment to anticipate')
  })

  it('gathers nothing rather than querying on an empty $or when there is no target', async () => {
    // An empty '$or' is a MongoDB error, not an empty result, so the query is never sent.
    armFind([{ _id: 'anno001', type: 'Annotation' }])

    assert.deepStrictEqual(await findLeafAnnotationsFor([undefined, '', null]), [])
    assert.deepStrictEqual(await findLeafAnnotationsFor(undefined), [])
    assert.strictEqual(capturedQuery, undefined, 'nothing to target is nothing to gather')
  })
})
