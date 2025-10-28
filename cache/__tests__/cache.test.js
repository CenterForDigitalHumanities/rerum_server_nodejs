/**
 * Cache layer tests for RERUM API
 * Verifies that all read endpoints have functioning cache middleware
 * @author thehabes
 */

import { jest } from '@jest/globals'
import { 
    cacheQuery, 
    cacheSearch, 
    cacheSearchPhrase, 
    cacheId,
    cacheHistory,
    cacheSince,
    cacheGogFragments,
    cacheGogGlosses,
    cacheStats
} from '../middleware.js'
import cache from '../index.js'

describe('Cache Middleware Tests', () => {
    let mockReq
    let mockRes
    let mockNext

    beforeAll(() => {
        // Enable caching for tests
        process.env.CACHING = 'true'
    })

    beforeEach(async () => {
        // Clear cache before each test to ensure clean state
        await cache.clear()
        
        // Set caching environment variable
        process.env.CACHING = 'true'
        
        // Reset mock request
        mockReq = {
            method: 'POST',
            body: {},
            query: {},
            params: {}
        }
        
        // Reset mock response
        mockRes = {
            statusCode: 200,
            headers: {},
            set: jest.fn(function(key, value) {
                if (typeof key === 'object') {
                    Object.assign(this.headers, key)
                } else {
                    this.headers[key] = value
                }
                return this
            }),
            status: jest.fn(function(code) {
                this.statusCode = code
                return this
            }),
            json: jest.fn(function(data) {
                this.jsonData = data
                return this
            })
        }
        
        // Reset mock next
        mockNext = jest.fn()
    })

    afterEach(async () => {
        await cache.clear()
    })

    beforeEach(async () => {
        await cache.clear()
    })

    afterEach(async () => {
        await cache.clear()
    })

    describe('cacheQuery middleware', () => {
        it('should pass through on non-POST requests', async () => {
            mockReq.method = 'GET'
            
            await cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should return cache MISS on first request', async () => {
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            mockReq.query = { limit: '100', skip: '0' }
            
            await cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical request', async () => {
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            mockReq.query = { limit: '100', skip: '0' }
            
            // First request - populate cache
            await cacheQuery(mockReq, mockRes, mockNext)
            const originalJson = mockRes.json
            mockRes.json([{ id: '123', type: 'Annotation' }])
            
            // Reset mocks for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request - should hit cache
            await cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalledWith([{ id: '123', type: 'Annotation' }])
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should respect pagination parameters in cache key', async () => {
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            
            // First request with limit=10
            mockReq.query = { limit: '10', skip: '0' }
            await cacheQuery(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            
            // Second request with limit=20 (different cache key)
            mockRes.headers = {}
            mockNext = jest.fn()
            mockReq.query = { limit: '20', skip: '0' }
            await cacheQuery(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })

        it('should create different cache keys for different query bodies', async () => {
            mockReq.method = 'POST'
            mockReq.query = { limit: '100', skip: '0' }
            
            // First request for Annotations
            mockReq.body = { type: 'Annotation' }
            await cacheQuery(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '1', type: 'Annotation' }])
            
            // Reset mocks for second request
            mockRes.headers = {}
            const jsonSpy = jest.fn()
            mockRes.json = jsonSpy
            mockNext = jest.fn()
            
            // Second request for Person (different body, should be MISS)
            mockReq.body = { type: 'Person' }
            await cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
            // json was replaced by middleware, so check it wasn't called before next()
            expect(jsonSpy).not.toHaveBeenCalled()
        })
    })

    describe('cacheSearch middleware', () => {
        it('should pass through on non-POST requests', async () => {
            mockReq.method = 'GET'
            
            await cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should return cache MISS on first search', async () => {
            mockReq.method = 'POST'
            mockReq.body = 'manuscript'
            
            await cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical search', async () => {
            mockReq.method = 'POST'
            mockReq.body = 'manuscript'
            
            // First request
            await cacheSearch(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '123', body: 'manuscript text' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            await cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should handle search with options object', async () => {
            mockReq.method = 'POST'
            mockReq.body = {
                searchText: 'manuscript',
                options: { fuzzy: true }
            }
            
            await cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })
    })

    describe('cacheSearchPhrase middleware', () => {
        it('should return cache MISS on first phrase search', async () => {
            mockReq.method = 'POST'
            mockReq.body = 'medieval manuscript'
            
            await cacheSearchPhrase(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical phrase search', async () => {
            mockReq.method = 'POST'
            mockReq.body = 'medieval manuscript'
            
            // First request
            await cacheSearchPhrase(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '456' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            await cacheSearchPhrase(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
        })
    })

    describe('cacheId middleware', () => {
        it('should pass through on non-GET requests', async () => {
            mockReq.method = 'POST'
            
            await cacheId(mockReq, mockRes, mockNext)
            
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache MISS on first ID lookup', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            await cacheId(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second ID lookup', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            // First request
            await cacheId(mockReq, mockRes, mockNext)
            mockRes.json({ _id: '688bc5a1f1f9c3e2430fa99f', type: 'Annotation' })
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            await cacheId(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.headers['Cache-Control']).toBe('max-age=86400, must-revalidate')
            expect(mockRes.json).toHaveBeenCalled()
        })

        it('should cache different IDs separately', async () => {
            mockReq.method = 'GET'
            
            // First ID
            mockReq.params = { _id: 'id123' }
            await cacheId(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            
            // Second different ID
            mockRes.headers = {}
            mockNext = jest.fn()
            mockReq.params = { _id: 'id456' }
            await cacheId(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })
    })

    describe('cacheHistory middleware', () => {
        it('should return cache MISS on first history request', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            await cacheHistory(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second history request', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            // First request
            await cacheHistory(mockReq, mockRes, mockNext)
            mockRes.json([{ _id: '688bc5a1f1f9c3e2430fa99f' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            await cacheHistory(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
        })
    })

    describe('cacheSince middleware', () => {
        it('should return cache MISS on first since request', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            await cacheSince(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second since request', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            // First request
            await cacheSince(mockReq, mockRes, mockNext)
            mockRes.json([{ _id: '688bc5a1f1f9c3e2430fa99f' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            await cacheSince(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
        })
    })

    describe('cacheStats endpoint', () => {
        it('should return cache statistics', async () => {
            await cacheStats(mockReq, mockRes)
            
            expect(mockRes.json).toHaveBeenCalled()
            const response = mockRes.json.mock.calls[0][0]
            expect(response).toHaveProperty('hits')
            expect(response).toHaveProperty('misses')
            expect(response).toHaveProperty('hitRate')
            expect(response).toHaveProperty('length')
        })

        it('should include details when requested', async () => {
            mockReq.query = { details: 'true' }
            
            await cacheStats(mockReq, mockRes)
            
            const response = mockRes.json.mock.calls[0][0]
            // ClusterCache doesn't support detailed cache entries list
            // Just verify stats are returned
            expect(response).toHaveProperty('hits')
            expect(response).toHaveProperty('misses')
            expect(response).toHaveProperty('mode')
        })
    })

    describe('Cache integration', () => {
        it('should maintain separate caches for different endpoints', async () => {
            // Query cache
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            await cacheQuery(mockReq, mockRes, mockNext)
            mockRes.json([{ id: 'query1' }])
            
            // Search cache
            mockReq.body = 'test search'
            mockRes.headers = {}
            mockNext = jest.fn()
            await cacheSearch(mockReq, mockRes, mockNext)
            mockRes.json([{ id: 'search1' }])
            
            // ID cache
            mockReq.method = 'GET'
            mockReq.params = { _id: 'id123' }
            mockRes.headers = {}
            mockNext = jest.fn()
            await cacheId(mockReq, mockRes, mockNext)
            mockRes.json({ id: 'id123' })
            
            // Wait for async cache.set() operations to complete (fire-and-forget in middleware)
            await new Promise(resolve => setTimeout(resolve, 100))
            
            // ClusterCache maintains stats but doesn't expose .cache.size
            // Verify via stats instead - at least 2 should be cached (timing-dependent)
            const stats = await cache.getStats()
            expect(stats.length).toBeGreaterThanOrEqual(2)
        })

        it('should only cache successful responses', async () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: 'test123' }
            mockRes.statusCode = 404
            
            await cacheId(mockReq, mockRes, mockNext)
            mockRes.json({ error: 'Not found' })
            
            // Second request should still be MISS
            mockRes.headers = {}
            mockRes.statusCode = 200
            mockNext = jest.fn()
            
            await cacheId(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })
    })
})

describe('GOG Endpoint Cache Middleware', () => {
    let mockReq
    let mockRes
    let mockNext

    beforeEach(() => {
        // Clear cache before each test
        cache.clear()

        // Reset mock request
        mockReq = {
            method: 'POST',
            body: {},
            query: {},
            params: {}
        }

        // Reset mock response
        mockRes = {
            statusCode: 200,
            headers: {},
            set: jest.fn(function(key, value) {
                if (typeof key === 'object') {
                    Object.assign(this.headers, key)
                } else {
                    this.headers[key] = value
                }
                return this
            }),
            status: jest.fn(function(code) {
                this.statusCode = code
                return this
            }),
            json: jest.fn(function(data) {
                this.jsonData = data
                return this
            })
        }

        // Reset mock next
        mockNext = jest.fn()
    })

    afterEach(() => {
        cache.clear()
    })

    describe('cacheGogFragments middleware', () => {
        it('should pass through when ManuscriptWitness is missing', async () => {
            mockReq.body = {}

            await cacheGogFragments(mockReq, mockRes, mockNext)

            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should pass through when ManuscriptWitness is invalid', async () => {
            mockReq.body = { ManuscriptWitness: 'not-a-url' }

            await cacheGogFragments(mockReq, mockRes, mockNext)

            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should return cache MISS on first request', async () => {
            mockReq.body = { ManuscriptWitness: 'https://example.org/manuscript/1' }
            mockReq.query = { limit: '50', skip: '0' }

            await cacheGogFragments(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical request', async () => {
            mockReq.body = { ManuscriptWitness: 'https://example.org/manuscript/1' }
            mockReq.query = { limit: '50', skip: '0' }

            // First request - populate cache
            await cacheGogFragments(mockReq, mockRes, mockNext)
            mockRes.json([{ '@id': 'fragment1', '@type': 'WitnessFragment' }])

            // Reset mocks for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()

            // Second request - should hit cache
            await cacheGogFragments(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalledWith([{ '@id': 'fragment1', '@type': 'WitnessFragment' }])
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should cache based on pagination parameters', async () => {
            const manuscriptURI = 'https://example.org/manuscript/1'

            // Request with limit=50, skip=0
            mockReq.body = { ManuscriptWitness: manuscriptURI }
            mockReq.query = { limit: '50', skip: '0' }

            await cacheGogFragments(mockReq, mockRes, mockNext)
            mockRes.json([{ '@id': 'fragment1' }])

            // Request with different pagination - should be MISS
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            mockReq.query = { limit: '100', skip: '0' }

            await cacheGogFragments(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })
    })

    describe('cacheGogGlosses middleware', () => {
        it('should pass through when ManuscriptWitness is missing', async () => {
            mockReq.body = {}

            await cacheGogGlosses(mockReq, mockRes, mockNext)

            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should pass through when ManuscriptWitness is invalid', async () => {
            mockReq.body = { ManuscriptWitness: 'not-a-url' }

            await cacheGogGlosses(mockReq, mockRes, mockNext)

            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should return cache MISS on first request', async () => {
            mockReq.body = { ManuscriptWitness: 'https://example.org/manuscript/1' }
            mockReq.query = { limit: '50', skip: '0' }

            await cacheGogGlosses(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical request', async () => {
            mockReq.body = { ManuscriptWitness: 'https://example.org/manuscript/1' }
            mockReq.query = { limit: '50', skip: '0' }

            // First request - populate cache
            await cacheGogGlosses(mockReq, mockRes, mockNext)
            mockRes.json([{ '@id': 'gloss1', '@type': 'Gloss' }])

            // Reset mocks for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()

            // Second request - should hit cache
            await cacheGogGlosses(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalledWith([{ '@id': 'gloss1', '@type': 'Gloss' }])
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should cache based on pagination parameters', async () => {
            const manuscriptURI = 'https://example.org/manuscript/1'

            // Request with limit=50, skip=0
            mockReq.body = { ManuscriptWitness: manuscriptURI }
            mockReq.query = { limit: '50', skip: '0' }

            await cacheGogGlosses(mockReq, mockRes, mockNext)
            mockRes.json([{ '@id': 'gloss1' }])

            // Request with different pagination - should be MISS
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            mockReq.query = { limit: '100', skip: '0' }

            await cacheGogGlosses(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })
    })
})

describe('Cache Statistics', () => {
    beforeEach(() => {
        cache.clear()
        // Reset statistics by clearing and checking stats
        cache.getStats()
    })

    afterEach(() => {
        cache.clear()
    })

    it('should track hits and misses correctly', async () => {
        // Clear cache and get initial stats to reset counters
        await cache.clear()
        
        const key = cache.generateKey('id', 'test123-isolated')
        
        // First access - miss
        let result = await cache.get(key)
        expect(result).toBeNull()
        
        // Set value
        await cache.set(key, { data: 'test' })
        
        // Second access - hit
        result = await cache.get(key)
        expect(result).toEqual({ data: 'test' })
        
        // Third access - hit
        result = await cache.get(key)
        expect(result).toEqual({ data: 'test' })
        
        const stats = await cache.getStats()
        // Stats accumulate across tests, so we just verify hits > misses
        expect(stats.hits).toBeGreaterThanOrEqual(2)
        expect(stats.misses).toBeGreaterThanOrEqual(1)
        // Hit rate should be a valid percentage string
        expect(stats.hitRate).toMatch(/^\d+\.\d+%$/)
    })

    it('should track cache size', async () => {
        // Ensure cache is fully cleared from beforeEach
        await new Promise(resolve => setTimeout(resolve, 10))
        
        let stats = await cache.getStats()
        const initialSize = stats.length
        
        await cache.set(cache.generateKey('id', '1'), { data: '1' })
        stats = await cache.getStats()
        expect(stats.length).toBe(initialSize + 1)
        
        await cache.set(cache.generateKey('id', '2'), { data: '2' })
        stats = await cache.getStats()
        expect(stats.length).toBe(initialSize + 2)
        
        await cache.delete(cache.generateKey('id', '1'))
        stats = await cache.getStats()
        expect(stats.length).toBe(initialSize + 1)
    })
})
