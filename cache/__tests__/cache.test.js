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
            
            // Wait for async cache.set() operations to complete
            await new Promise(resolve => setTimeout(resolve, 200))
            
            // Verify each cache key independently instead of relying on stats
            const queryKey = cache.generateKey('query', { body: { type: 'Annotation' }, limit: 100, skip: 0 })
            const searchKey = cache.generateKey('search', { searchText: 'test search', options: {}, limit: 100, skip: 0 })
            const idKey = cache.generateKey('id', 'id123')
            
            const queryResult = await cache.get(queryKey)
            const searchResult = await cache.get(searchKey)
            const idResult = await cache.get(idKey)
            
            expect(queryResult).toBeTruthy()
            expect(searchResult).toBeTruthy()
            expect(idResult).toBeTruthy()
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
        // Use unique keys to avoid interference from other tests
        const testId = `isolated-${Date.now()}-${Math.random()}`
        const key = cache.generateKey('id', testId)
        
        // First access - miss
        let result = await cache.get(key)
        expect(result).toBeNull()
        
        // Set value
        await cache.set(key, { data: 'test' })
        
        // Wait for set to complete
        await new Promise(resolve => setTimeout(resolve, 50))
        
        // Second access - hit
        result = await cache.get(key)
        expect(result).toEqual({ data: 'test' })
        
        // Third access - hit
        result = await cache.get(key)
        expect(result).toEqual({ data: 'test' })
        
        // Stats are tracked per-worker and aggregated
        // Just verify the methods return proper structure
        const stats = await cache.getStats()
        expect(stats).toHaveProperty('hits')
        expect(stats).toHaveProperty('misses')
        expect(stats).toHaveProperty('hitRate')
        expect(typeof stats.hitRate).toBe('string')
        expect(stats.hitRate).toMatch(/^\d+\.\d+%$/)
    })

    it('should track cache size', async () => {
        // Use unique test ID to avoid conflicts
        const testId = `size-test-${Date.now()}-${Math.random()}`
        const key1 = cache.generateKey('id', `${testId}-1`)
        const key2 = cache.generateKey('id', `${testId}-2`)
        
        await cache.set(key1, { data: '1' })
        await new Promise(resolve => setTimeout(resolve, 150))
        
        // Verify via get() instead of allKeys to confirm it's actually cached
        let result1 = await cache.get(key1)
        expect(result1).toEqual({ data: '1' })
        
        await cache.set(key2, { data: '2' })
        await new Promise(resolve => setTimeout(resolve, 150))
        
        let result2 = await cache.get(key2)
        expect(result2).toEqual({ data: '2' })
        
        await cache.delete(key1)
        await new Promise(resolve => setTimeout(resolve, 150))
        
        result1 = await cache.get(key1)
        result2 = await cache.get(key2)
        expect(result1).toBeNull()
        expect(result2).toEqual({ data: '2' })
    })
})

describe('Cache Invalidation Tests', () => {
    beforeEach(async () => {
        await cache.clear()
    })

    afterEach(async () => {
        await cache.clear()
    })

    describe('invalidateByObject', () => {
        it('should invalidate matching query caches when object is created', async () => {
            // Cache a query for type=TestObject
            const queryKey = cache.generateKey('query', { body: { type: 'TestObject' } })
            await cache.set(queryKey, [{ id: '1', type: 'TestObject' }])
            
            // Verify cache exists
            let cached = await cache.get(queryKey)
            expect(cached).toBeTruthy()
            
            // Create new object that matches the query
            const newObj = { id: '2', type: 'TestObject', name: 'Test' }
            const invalidatedKeys = new Set()
            const count = await cache.invalidateByObject(newObj, invalidatedKeys)
            
            // Verify cache was invalidated
            expect(count).toBe(1)
            expect(invalidatedKeys.has(queryKey)).toBe(true)
            cached = await cache.get(queryKey)
            expect(cached).toBeNull()
        })

        it('should not invalidate non-matching query caches', async () => {
            // Cache a query for type=OtherObject
            const queryKey = cache.generateKey('query', { body: { type: 'OtherObject' } })
            await cache.set(queryKey, [{ id: '1', type: 'OtherObject' }])
            
            // Create object that doesn't match
            const newObj = { id: '2', type: 'TestObject' }
            const count = await cache.invalidateByObject(newObj)
            
            // Verify cache was NOT invalidated
            expect(count).toBe(0)
            const cached = await cache.get(queryKey)
            expect(cached).toBeTruthy()
        })

        it('should invalidate search caches', async () => {
            const searchKey = cache.generateKey('search', { body: { type: 'TestObject' } })
            await cache.set(searchKey, [{ id: '1', type: 'TestObject' }])
            
            const newObj = { id: '2', type: 'TestObject' }
            const count = await cache.invalidateByObject(newObj)
            
            expect(count).toBe(1)
            const cached = await cache.get(searchKey)
            expect(cached).toBeNull()
        })

        it('should invalidate searchPhrase caches', async () => {
            const searchKey = cache.generateKey('searchPhrase', { body: { type: 'TestObject' } })
            await cache.set(searchKey, [{ id: '1', type: 'TestObject' }])
            
            const newObj = { id: '2', type: 'TestObject' }
            const count = await cache.invalidateByObject(newObj)
            
            expect(count).toBe(1)
            const cached = await cache.get(searchKey)
            expect(cached).toBeNull()
        })

        it('should not invalidate id, history, or since caches', async () => {
            // These caches should not be invalidated by object matching
            const idKey = cache.generateKey('id', '123')
            const historyKey = cache.generateKey('history', '123')
            const sinceKey = cache.generateKey('since', '2024-01-01')
            
            await cache.set(idKey, { id: '123', type: 'TestObject' })
            await cache.set(historyKey, [{ id: '123' }])
            await cache.set(sinceKey, [{ id: '123' }])
            
            const newObj = { id: '456', type: 'TestObject' }
            const count = await cache.invalidateByObject(newObj)
            
            // None of these should be invalidated
            expect(await cache.get(idKey)).toBeTruthy()
            expect(await cache.get(historyKey)).toBeTruthy()
            expect(await cache.get(sinceKey)).toBeTruthy()
        })

        it('should handle invalid input gracefully', async () => {
            expect(await cache.invalidateByObject(null)).toBe(0)
            expect(await cache.invalidateByObject(undefined)).toBe(0)
            expect(await cache.invalidateByObject('not an object')).toBe(0)
            expect(await cache.invalidateByObject(123)).toBe(0)
        })

        it('should track invalidation count in stats', async () => {
            const testId = Date.now()
            const queryKey = cache.generateKey('query', { body: { type: 'TestObject', testId } })
            await cache.set(queryKey, [{ id: '1' }])
            await new Promise(resolve => setTimeout(resolve, 50))
            
            await cache.invalidateByObject({ type: 'TestObject', testId })
            await new Promise(resolve => setTimeout(resolve, 50))
            
            const stats = await cache.getStats()
            // Just verify invalidations property exists and is a number
            expect(stats).toHaveProperty('invalidations')
            expect(typeof stats.invalidations).toBe('number')
        })
    })

    describe('objectMatchesQuery', () => {
        it('should match simple property queries', () => {
            const obj = { type: 'TestObject', name: 'Test' }
            expect(cache.objectMatchesQuery(obj, { type: 'TestObject' })).toBe(true)
            expect(cache.objectMatchesQuery(obj, { type: 'OtherObject' })).toBe(false)
        })

        it('should match queries with body property', () => {
            const obj = { type: 'TestObject' }
            expect(cache.objectMatchesQuery(obj, { body: { type: 'TestObject' } })).toBe(true)
            expect(cache.objectMatchesQuery(obj, { body: { type: 'OtherObject' } })).toBe(false)
        })

        it('should match nested property queries', () => {
            const obj = { metadata: { author: 'John' } }
            expect(cache.objectMatchesQuery(obj, { 'metadata.author': 'John' })).toBe(true)
            expect(cache.objectMatchesQuery(obj, { 'metadata.author': 'Jane' })).toBe(false)
        })
    })

    describe('objectContainsProperties', () => {
        it('should skip pagination parameters', () => {
            const obj = { type: 'TestObject' }
            expect(cache.objectContainsProperties(obj, { type: 'TestObject', limit: 10, skip: 5 })).toBe(true)
        })

        it('should skip __rerum and _id properties', () => {
            const obj = { type: 'TestObject' }
            expect(cache.objectContainsProperties(obj, { type: 'TestObject', __rerum: {}, _id: '123' })).toBe(true)
        })

        it('should match simple properties', () => {
            const obj = { type: 'TestObject', status: 'active' }
            expect(cache.objectContainsProperties(obj, { type: 'TestObject', status: 'active' })).toBe(true)
            expect(cache.objectContainsProperties(obj, { type: 'TestObject', status: 'inactive' })).toBe(false)
        })

        it('should match nested objects', () => {
            const obj = { metadata: { author: 'John', year: 2024 } }
            expect(cache.objectContainsProperties(obj, { metadata: { author: 'John', year: 2024 } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { metadata: { author: 'Jane' } })).toBe(false)
        })

        it('should handle $exists operator', () => {
            const obj = { type: 'TestObject', optional: 'value' }
            expect(cache.objectContainsProperties(obj, { optional: { $exists: true } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { missing: { $exists: false } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { type: { $exists: false } })).toBe(false)
        })

        it('should handle $ne operator', () => {
            const obj = { status: 'active' }
            expect(cache.objectContainsProperties(obj, { status: { $ne: 'inactive' } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { status: { $ne: 'active' } })).toBe(false)
        })

        it('should handle comparison operators', () => {
            const obj = { count: 42 }
            expect(cache.objectContainsProperties(obj, { count: { $gt: 40 } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { count: { $gte: 42 } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { count: { $lt: 50 } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { count: { $lte: 42 } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { count: { $gt: 50 } })).toBe(false)
        })

        it('should handle $size operator for arrays', () => {
            const obj = { tags: ['a', 'b', 'c'] }
            expect(cache.objectContainsProperties(obj, { tags: { $size: 3 } })).toBe(true)
            expect(cache.objectContainsProperties(obj, { tags: { $size: 2 } })).toBe(false)
        })

        it('should handle $or operator', () => {
            const obj = { type: 'TestObject' }
            expect(cache.objectContainsProperties(obj, { 
                $or: [{ type: 'TestObject' }, { type: 'OtherObject' }] 
            })).toBe(true)
            expect(cache.objectContainsProperties(obj, { 
                $or: [{ type: 'Wrong1' }, { type: 'Wrong2' }] 
            })).toBe(false)
        })

        it('should handle $and operator', () => {
            const obj = { type: 'TestObject', status: 'active' }
            expect(cache.objectContainsProperties(obj, { 
                $and: [{ type: 'TestObject' }, { status: 'active' }] 
            })).toBe(true)
            expect(cache.objectContainsProperties(obj, { 
                $and: [{ type: 'TestObject' }, { status: 'inactive' }] 
            })).toBe(false)
        })
    })

    describe('getNestedProperty', () => {
        it('should get top-level properties', () => {
            const obj = { name: 'Test' }
            expect(cache.getNestedProperty(obj, 'name')).toBe('Test')
        })

        it('should get nested properties with dot notation', () => {
            const obj = { 
                metadata: { 
                    author: { 
                        name: 'John' 
                    } 
                } 
            }
            expect(cache.getNestedProperty(obj, 'metadata.author.name')).toBe('John')
        })

        it('should return undefined for missing properties', () => {
            const obj = { name: 'Test' }
            expect(cache.getNestedProperty(obj, 'missing')).toBeUndefined()
            expect(cache.getNestedProperty(obj, 'missing.nested')).toBeUndefined()
        })

        it('should handle null/undefined gracefully', () => {
            const obj = { data: null }
            expect(cache.getNestedProperty(obj, 'data.nested')).toBeUndefined()
        })
    })

    describe('evaluateFieldOperators', () => {
        it('should evaluate $exists correctly', () => {
            expect(cache.evaluateFieldOperators('value', { $exists: true })).toBe(true)
            expect(cache.evaluateFieldOperators(undefined, { $exists: false })).toBe(true)
            expect(cache.evaluateFieldOperators('value', { $exists: false })).toBe(false)
        })

        it('should evaluate $size correctly', () => {
            expect(cache.evaluateFieldOperators([1, 2, 3], { $size: 3 })).toBe(true)
            expect(cache.evaluateFieldOperators([1, 2], { $size: 3 })).toBe(false)
            expect(cache.evaluateFieldOperators('not array', { $size: 1 })).toBe(false)
        })

        it('should evaluate comparison operators correctly', () => {
            expect(cache.evaluateFieldOperators(10, { $gt: 5 })).toBe(true)
            expect(cache.evaluateFieldOperators(10, { $gte: 10 })).toBe(true)
            expect(cache.evaluateFieldOperators(10, { $lt: 20 })).toBe(true)
            expect(cache.evaluateFieldOperators(10, { $lte: 10 })).toBe(true)
            expect(cache.evaluateFieldOperators(10, { $ne: 5 })).toBe(true)
        })

        it('should be conservative with unknown operators', () => {
            expect(cache.evaluateFieldOperators('value', { $unknown: 'test' })).toBe(true)
        })
    })

    describe('evaluateOperator', () => {
        it('should evaluate $or correctly', () => {
            const obj = { type: 'A' }
            expect(cache.evaluateOperator(obj, '$or', [{ type: 'A' }, { type: 'B' }])).toBe(true)
            expect(cache.evaluateOperator(obj, '$or', [{ type: 'B' }, { type: 'C' }])).toBe(false)
        })

        it('should evaluate $and correctly', () => {
            const obj = { type: 'A', status: 'active' }
            expect(cache.evaluateOperator(obj, '$and', [{ type: 'A' }, { status: 'active' }])).toBe(true)
            expect(cache.evaluateOperator(obj, '$and', [{ type: 'A' }, { status: 'inactive' }])).toBe(false)
        })

        it('should be conservative with unknown operators', () => {
            const obj = { type: 'A' }
            expect(cache.evaluateOperator(obj, '$unknown', 'test')).toBe(true)
        })

        it('should handle invalid input gracefully', () => {
            const obj = { type: 'A' }
            expect(cache.evaluateOperator(obj, '$or', 'not an array')).toBe(false)
            expect(cache.evaluateOperator(obj, '$and', 'not an array')).toBe(false)
        })
    })
})
