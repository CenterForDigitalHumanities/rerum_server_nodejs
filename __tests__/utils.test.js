import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import utils from '../utils.js'
import { generateSlugId } from '../controllers/utils.js'
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
