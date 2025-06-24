import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import controller from '../../db-controller.js'

// Mock the database module
jest.mock('../../database/index.js', () => ({
    db: {
        findOne: jest.fn(),
        replaceOne: jest.fn()
    }
}))

// Import the mocked db after mocking
import { db } from '../../database/index.js'

// Helper to add auth to requests
const addAuth = (req, res, next) => {
    req.user = {"http://store.rerum.io/agent": "test-user"}
    next()
}

// Create a test Express app
const routeTester = express()
routeTester.use(express.json())
routeTester.use(express.urlencoded({ extended: false }))

// Mount our routes
routeTester.use('/overwrite', [addAuth, controller.overwrite])
routeTester.use('/id/:_id', controller.id)

describe('Overwrite Optimistic Locking', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('should succeed when no version is specified (backwards compatibility)', async () => {
        const mockObject = {
            _id: 'test-id',
            '@id': 'http://example.com/test-id',
            '@context': 'http://example.com/context',
            '__rerum': {
                isOverwritten: '',
                generatedBy: 'test-user'
            },
            data: 'original-data'
        }

        db.findOne.mockResolvedValue(mockObject)
        db.replaceOne.mockResolvedValue({ modifiedCount: 1 })

        const response = await request(routeTester)
            .put('/overwrite')
            .send({
                '@id': 'http://example.com/test-id',
                data: 'updated-data'
            })

        expect(response.status).toBe(200)
        expect(response.headers['current-overwritten-version']).toBeDefined()
    })

    test('should succeed when correct version is provided', async () => {
        const mockObject = {
            _id: 'test-id',
            '@id': 'http://example.com/test-id',
            '@context': 'http://example.com/context',
            '__rerum': {
                isOverwritten: '2025-06-24T10:00:00',
                generatedBy: 'test-user'
            },
            data: 'original-data'
        }

        db.findOne.mockResolvedValue(mockObject)
        db.replaceOne.mockResolvedValue({ modifiedCount: 1 })

        const response = await request(routeTester)
            .put('/overwrite')
            .set('If-Overwritten-Version', '2025-06-24T10:00:00')
            .send({
                '@id': 'http://example.com/test-id',
                data: 'updated-data'
            })

        expect(response.status).toBe(200)
        expect(response.headers['current-overwritten-version']).toBeDefined()
    })

    test('should fail with 409 when version mismatch occurs', async () => {
        const mockObject = {
            _id: 'test-id',
            '@id': 'http://example.com/test-id',
            '@context': 'http://example.com/context',
            '__rerum': {
                isOverwritten: '2025-06-24T10:30:00', // Different from expected
                generatedBy: 'test-user'
            },
            data: 'original-data'
        }

        db.findOne.mockResolvedValue(mockObject)

        const response = await request(routeTester)
            .put('/overwrite')
            .set('If-Overwritten-Version', '2025-06-24T10:00:00')
            .send({
                '@id': 'http://example.com/test-id',
                data: 'updated-data'
            })

        expect(response.status).toBe(409)
        expect(response.body.message).toContain('Version conflict detected')
        expect(response.body.currentVersion).toBe('2025-06-24T10:30:00')
    })

    test('should accept version via request body as fallback', async () => {
        const mockObject = {
            _id: 'test-id',
            '@id': 'http://example.com/test-id',
            '@context': 'http://example.com/context',
            '__rerum': {
                isOverwritten: '2025-06-24T10:00:00',
                generatedBy: 'test-user'
            },
            data: 'original-data'
        }

        db.findOne.mockResolvedValue(mockObject)
        db.replaceOne.mockResolvedValue({ modifiedCount: 1 })

        const response = await request(routeTester)
            .put('/overwrite')
            .send({
                '@id': 'http://example.com/test-id',
                '__expectedVersion': '2025-06-24T10:00:00',
                data: 'updated-data'
            })

        expect(response.status).toBe(200)
    })
})

describe('ID endpoint includes version header', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('should include Current-Overwritten-Version header in GET /id response', async () => {
        const mockObject = {
            _id: 'test-id',
            '@id': 'http://example.com/test-id',
            '__rerum': {
                isOverwritten: '2025-06-24T10:00:00'
            },
            data: 'some-data'
        }

        db.findOne.mockResolvedValue(mockObject)

        const response = await request(routeTester)
            .get('/id/test-id')

        expect(response.status).toBe(200)
        expect(response.headers['current-overwritten-version']).toBe('2025-06-24T10:00:00')
    })

    test('should include empty string for new objects', async () => {
        const mockObject = {
            _id: 'test-id',
            '@id': 'http://example.com/test-id',
            '__rerum': {
                isOverwritten: ''
            },
            data: 'some-data'
        }

        db.findOne.mockResolvedValue(mockObject)

        const response = await request(routeTester)
            .get('/id/test-id')

        expect(response.status).toBe(200)
        expect(response.headers['current-overwritten-version']).toBe('')
    })
})
