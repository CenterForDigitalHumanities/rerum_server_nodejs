import request from 'supertest'
import app from '../../app.js'
import { jest } from '@jest/globals'

// Mock the database and auth modules
const mockOverwrite = jest.fn()
const mockFindOne = jest.fn()
const mockReplaceOne = jest.fn()
const mockCheckJwt = jest.fn((req, res, next) => {
    req.user = { sub: 'test-user' }
    next()
})

jest.mock('../../db-controller.js', () => ({
    default: {
        overwrite: mockOverwrite,
        findOne: mockFindOne,
        replaceOne: mockReplaceOne,
        id: jest.fn()
    }
}))

jest.mock('../../auth/index.js', () => ({
    default: {
        checkJwt: mockCheckJwt
    }
}))

describe('Overwrite Optimistic Locking', () => {
    beforeEach(() => {
        // Reset mocks
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

        mockFindOne.mockResolvedValue(mockObject)
        mockReplaceOne.mockResolvedValue({ modifiedCount: 1 })

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

        mockFindOne.mockResolvedValue(mockObject)
        mockReplaceOne.mockResolvedValue({ modifiedCount: 1 })

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

        mockFindOne.mockResolvedValue(mockObject)

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

        mockFindOne.mockResolvedValue(mockObject)
        mockReplaceOne.mockResolvedValue({ modifiedCount: 1 })

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

        mockFindOne.mockResolvedValue(mockObject)

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

        mockFindOne.mockResolvedValue(mockObject)

        const response = await request(app)
            .get('/id/test-id')

        expect(response.status).toBe(200)
        expect(response.headers['current-overwritten-version']).toBe('')
    })
})
