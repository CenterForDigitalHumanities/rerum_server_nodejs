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
  getPagination
} from '../controllers/utils.js'
import { db, resetMocks } from '../database/index.js'

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
  it('returns the default limit and skip 0 for an empty query', () => {
    const result = getPagination({}, 100)
    assert.strictEqual(result.limit, 100)
    assert.strictEqual(result.skip, 0)
  })

  it('parses numeric string values from the query', () => {
    const result = getPagination({ limit: '50', skip: '10' })
    assert.strictEqual(result.limit, 50)
    assert.strictEqual(result.skip, 10)
  })

  it('falls back to defaults on non-numeric or non-positive input', () => {
    const result = getPagination({ limit: 'bogus', skip: 'nope' }, 100)
    assert.strictEqual(result.limit, 100)
    assert.strictEqual(result.skip, 0)
  })

  it('clamps an unreasonably large limit below the max', () => {
    const huge = Number.MAX_SAFE_INTEGER
    const result = getPagination({ limit: String(huge) })
    assert.ok(result.limit > 0)
    assert.ok(result.limit < huge, `limit should be clamped below ${huge}`)
  })
})
