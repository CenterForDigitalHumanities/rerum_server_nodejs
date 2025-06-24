import request from 'supertest'
import app from '../../app.js'
import { jest } from '@jest/globals'

// Mock the database and auth modules
jest.mock('../../db-controller.js')
jest.mock('../../auth/index.js')

describe('Overwrite Optimistic Locking', () => {
    let mockDb
    let mockAuth

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks()
        
        mockDb = require('../../db-controller.js')
        mockAuth = require('../../auth/index.js')
        
        // Mock auth to always pass
        mockAuth.checkJwt = jest.fn((req, res, next) => {
            req.user = { sub: 'test-user' }
            next()
        })
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

        mockDb.findOne = jest.fn().mockResolvedValue(mockObject)
        mockDb.replaceOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })

        const response = await request(app)
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

        mockDb.findOne = jest.fn().mockResolvedValue(mockObject)
        mockDb.replaceOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })

        const response = await request(app)
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

        mockDb.findOne = jest.fn().mockResolvedValue(mockObject)

        const response = await request(app)
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

        mockDb.findOne = jest.fn().mockResolvedValue(mockObject)
        mockDb.replaceOne = jest.fn().mockResolvedValue({ modifiedCount: 1 })

        const response = await request(app)
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
    let mockDb

    beforeEach(() => {
        jest.clearAllMocks()
        mockDb = require('../../db-controller.js')
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

        mockDb.findOne = jest.fn().mockResolvedValue(mockObject)

        const response = await request(app)
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

        mockDb.findOne = jest.fn().mockResolvedValue(mockObject)

        const response = await request(app)
            .get('/id/test-id')

        expect(response.status).toBe(200)
        expect(response.headers['current-overwritten-version']).toBe('')
    })
})
