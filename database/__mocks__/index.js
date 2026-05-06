#!/usr/bin/env node

/**
 * Jest mock for the database/index.js module.
 * Replaces all MongoDB operations with jest.fn() stubs so tests
 * can run without a live database connection.
 *
 * Defaults (can be overridden per-test with mockResolvedValueOnce / mockReturnValueOnce):
 *   db.findOne   → resolves null
 *   db.find      → returns a chainable cursor whose toArray resolves []
 *   db.insertOne → resolves { insertedId: 'testid123' }
 *   db.replaceOne→ resolves { modifiedCount: 1 }
 *   db.bulkWrite → resolves { result: { insertedIds: [] }, insertedCount: 0 }
 *   db.deleteOne → resolves { deletedCount: 1 }
 *   newID        → returns 'testid123'
 *   isValidID    → returns false  (forces ObjectID() path in controllers)
 *   connected    → resolves true
 *
 * @author thehabes
 */

import { jest } from '@jest/globals'

/** Chainable cursor stub returned by db.find() */
const mockCursor = {
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue([])
}

export const db = {
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockReturnValue(mockCursor),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'testid123' }),
  replaceOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  countDocuments: jest.fn().mockResolvedValue(0),
  bulkWrite: jest.fn().mockResolvedValue({
    result: { insertedIds: [{ _id: 'bulkid1' }, { _id: 'bulkid2' }] },
    insertedIds: {},
    insertedCount: 0
  }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 })
}

export const newID = jest.fn().mockReturnValue('testid123')
export const isValidID = jest.fn().mockReturnValue(false)
export const connected = jest.fn().mockResolvedValue(true)
