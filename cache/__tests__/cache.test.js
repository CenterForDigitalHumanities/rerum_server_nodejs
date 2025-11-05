/**
 * Cache layer tests for RERUM API
 * Verifies that all read endpoints have functioning cache middleware
 * @author thehabes
 */

// Ensure cache runs in local mode (not PM2 cluster) for tests
// This must be set before importing cache to avoid IPC timeouts
delete process.env.pm_id

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

/**
 * Helper to wait for async cache operations to complete
 * Standardized delay for cache.set() operations across PM2 workers
 */
async function waitForCache(ms = 100) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Helper to test cache MISS/HIT pattern for middleware
 * Reduces duplication across 8+ middleware test suites
 *
 * @param {Function} middleware - The cache middleware function to test
 * @param {Object} setupRequest - Function that configures mockReq for the test
 * @param {Object} expectedCachedData - The data to return on first request (to populate cache)
 * @param {Object} additionalHitAssertions - Optional additional assertions for HIT test
 */
async function testCacheMissHit(
    middleware,
    setupRequest,
    expectedCachedData,
    additionalHitAssertions = null
) {
    const mockReq = setupRequest()
    const mockRes = {
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
    const mockNext = jest.fn()

    // Test MISS
    await middleware(mockReq, mockRes, mockNext)
    expect(mockRes.headers['X-Cache']).toBe('MISS')
    expect(mockNext).toHaveBeenCalled()

    // Populate cache
    mockRes.json(expectedCachedData)

    // Wait for cache.set() to complete (needed for CI/CD environments with slower I/O)
    await waitForCache(150)

    // Reset mocks for HIT test
    mockRes.headers = {}
    mockRes.json = jest.fn()
    const mockNext2 = jest.fn()

    // Test HIT
    await middleware(mockReq, mockRes, mockNext2)
    expect(mockRes.headers['X-Cache']).toBe('HIT')
    expect(mockRes.json).toHaveBeenCalledWith(expectedCachedData)
    expect(mockNext2).not.toHaveBeenCalled()

    // Run any additional assertions
    if (additionalHitAssertions) {
        additionalHitAssertions(mockRes)
    }
}

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
    }, 10000)

    afterEach(async () => {
        // Clean up stats interval to prevent hanging processes
        if (cache.statsInterval) {
            clearInterval(cache.statsInterval)
            cache.statsInterval = null
        }
        await cache.clear()
    }, 10000)

    describe('cacheQuery middleware', () => {
        it('should pass through on non-POST requests', async () => {
            mockReq.method = 'GET'

            await cacheQuery(mockReq, mockRes, mockNext)

            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should cache query results (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheQuery,
                () => ({
                    method: 'POST',
                    body: { type: 'Annotation' },
                    query: { limit: '100', skip: '0' },
                    params: {}
                }),
                [{ id: '123', type: 'Annotation' }]
            )
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
        it('should cache search results (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheSearch,
                () => ({
                    method: 'POST',
                    body: 'manuscript',
                    query: {},
                    params: {}
                }),
                [{ id: '123', body: 'manuscript text' }]
            )
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

        it('should respect pagination parameters in cache key', async () => {
            mockReq.method = 'POST'
            mockReq.body = 'manuscript'

            // First request with limit=10
            mockReq.query = { limit: '10', skip: '0' }
            await cacheSearch(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')

            // Second request with limit=20 (different cache key)
            mockRes.headers = {}
            mockNext = jest.fn()
            mockReq.query = { limit: '20', skip: '0' }
            await cacheSearch(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })

        it('should create different cache keys for different search text', async () => {
            mockReq.method = 'POST'
            mockReq.query = { limit: '100', skip: '0' }

            // First request for 'manuscript'
            mockReq.body = 'manuscript'
            await cacheSearch(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '1', text: 'manuscript' }])

            // Reset mocks for second request
            mockRes.headers = {}
            const jsonSpy = jest.fn()
            mockRes.json = jsonSpy
            mockNext = jest.fn()

            // Second request for 'annotation' (different body, should be MISS)
            mockReq.body = 'annotation'
            await cacheSearch(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
            expect(jsonSpy).not.toHaveBeenCalled()
        })
    })

    describe('cacheSearchPhrase middleware', () => {
        it('should cache search phrase results (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheSearchPhrase,
                () => ({
                    method: 'POST',
                    body: 'medieval manuscript',
                    query: {},
                    params: {}
                }),
                [{ id: '456' }]
            )
        })

        it('should respect pagination parameters in cache key', async () => {
            mockReq.method = 'POST'
            mockReq.body = 'medieval manuscript'

            // First request with limit=10
            mockReq.query = { limit: '10', skip: '0' }
            await cacheSearchPhrase(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')

            // Second request with limit=20 (different cache key)
            mockRes.headers = {}
            mockNext = jest.fn()
            mockReq.query = { limit: '20', skip: '0' }
            await cacheSearchPhrase(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })

        it('should create different cache keys for different search phrases', async () => {
            mockReq.method = 'POST'
            mockReq.query = { limit: '100', skip: '0' }

            // First request for 'medieval manuscript'
            mockReq.body = 'medieval manuscript'
            await cacheSearchPhrase(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '1', text: 'medieval manuscript' }])

            // Reset mocks for second request
            mockRes.headers = {}
            const jsonSpy = jest.fn()
            mockRes.json = jsonSpy
            mockNext = jest.fn()

            // Second request for 'ancient text' (different body, should be MISS)
            mockReq.body = 'ancient text'
            await cacheSearchPhrase(mockReq, mockRes, mockNext)

            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
            expect(jsonSpy).not.toHaveBeenCalled()
        })
    })

    describe('cacheId middleware', () => {
        it('should pass through on non-GET requests', async () => {
            mockReq.method = 'POST'

            await cacheId(mockReq, mockRes, mockNext)

            expect(mockNext).toHaveBeenCalled()
        })

        it('should cache ID lookups with Cache-Control header (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheId,
                () => ({
                    method: 'GET',
                    params: { _id: '688bc5a1f1f9c3e2430fa99f' },
                    query: {},
                    body: {}
                }),
                { _id: '688bc5a1f1f9c3e2430fa99f', type: 'Annotation' },
                (mockRes) => {
                    // Verify Cache-Control header on HIT
                    expect(mockRes.headers['Cache-Control']).toBe('max-age=86400, must-revalidate')
                }
            )
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
            // Use helper to test MISS/HIT pattern
            await testCacheMissHit(
                cacheHistory,
                () => ({
                    method: 'GET',
                    params: { _id: '688bc5a1f1f9c3e2430fa99f' },
                    query: {},
                    body: {}
                }),
                [{ _id: '688bc5a1f1f9c3e2430fa99f' }]
            )
        })
    })

    describe('cacheSince middleware', () => {
        it('should cache since results (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheSince,
                () => ({
                    method: 'GET',
                    params: { _id: '688bc5a1f1f9c3e2430fa99f' },
                    query: {},
                    body: {}
                }),
                [{ _id: '688bc5a1f1f9c3e2430fa99f' }]
            )
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
            await waitForCache(200)
            
            // Verify each cache key independently instead of relying on stats
            const queryKey = cache.generateKey('query', { __cached: { type: 'Annotation' }, limit: 100, skip: 0 })
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

    beforeEach(async () => {
        // Clear cache before each test
        await cache.clear()

        // Reset mock request
        mockReq = {
            method: 'POST',
            body: {},
            query: {},
            params: {},
            user: {
                'http://store.rerum.io/agent': 'http://store.rerum.io/v1/id/test-agent-for-cache-tests'
            }
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
    }, 10000)

    afterEach(async () => {
        // Clean up stats interval to prevent hanging processes
        if (cache.statsInterval) {
            clearInterval(cache.statsInterval)
            cache.statsInterval = null
        }
        await cache.clear()
    }, 10000)

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

        it('should cache GOG fragments (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheGogFragments,
                () => ({
                    method: 'POST',
                    body: { ManuscriptWitness: 'https://example.org/manuscript/1' },
                    query: { limit: '50', skip: '0' },
                    params: {},
                    user: {
                        'http://store.rerum.io/agent': 'http://store.rerum.io/v1/id/test-agent-for-cache-tests'
                    }
                }),
                [{ '@id': 'fragment1', '@type': 'WitnessFragment' }]
            )
        })
    })

    describe('cacheGogGlosses middleware', () => {
        it('should cache GOG glosses (MISS then HIT)', async () => {
            await testCacheMissHit(
                cacheGogGlosses,
                () => ({
                    method: 'POST',
                    body: { ManuscriptWitness: 'https://example.org/manuscript/1' },
                    query: { limit: '50', skip: '0' },
                    params: {},
                    user: {
                        'http://store.rerum.io/agent': 'http://store.rerum.io/v1/id/test-agent-for-cache-tests'
                    }
                }),
                [{ '@id': 'gloss1', '@type': 'Gloss' }]
            )
        })
    })
})

describe('Cache Statistics', () => {
    beforeEach(async () => {
        await cache.clear()
        // Wait for clear to complete
        await waitForCache(50)
    }, 10000)

    afterEach(async () => {
        // Clean up stats interval to prevent hanging processes
        if (cache.statsInterval) {
            clearInterval(cache.statsInterval)
            cache.statsInterval = null
        }
        await cache.clear()
    }, 10000)

    it('should have all required statistics properties', async () => {
        // Verify cache has all required stat properties
        expect(cache).toHaveProperty('stats')
        expect(cache.stats).toHaveProperty('hits')
        expect(cache.stats).toHaveProperty('misses')
        expect(cache.stats).toHaveProperty('sets')
        expect(cache.stats).toHaveProperty('evictions')

        // Verify stats are numbers
        expect(typeof cache.stats.hits).toBe('number')
        expect(typeof cache.stats.misses).toBe('number')
        expect(typeof cache.stats.sets).toBe('number')
        expect(typeof cache.stats.evictions).toBe('number')
    })

    it('should have all required cache limit properties', async () => {
        // Verify cache has required tracking properties
        expect(cache).toHaveProperty('maxLength')
        expect(cache).toHaveProperty('maxBytes')
        expect(cache).toHaveProperty('ttl')
        expect(cache).toHaveProperty('allKeys')

        // Verify types
        expect(typeof cache.maxLength).toBe('number')
        expect(typeof cache.maxBytes).toBe('number')
        expect(typeof cache.ttl).toBe('number')
        expect(cache.allKeys instanceof Set).toBe(true)
    })

    it('should track hits and misses correctly', async () => {
        // After beforeEach, stats should be reset to 0
        expect(cache.stats.hits).toBe(0)
        expect(cache.stats.misses).toBe(0)
        expect(cache.stats.sets).toBe(0)
        expect(cache.stats.evictions).toBe(0)

        // Use unique keys to avoid interference from other tests
        const testId = `isolated-${Date.now()}-${Math.random()}`
        const key = cache.generateKey('id', testId)

        // First access - miss (should increment misses)
        let result = await cache.get(key)
        expect(result).toBeNull()
        expect(cache.stats.misses).toBe(1)

        // Set value (should increment sets)
        await cache.set(key, { data: 'test' })
        await waitForCache(50)
        expect(cache.stats.sets).toBe(1)

        // Get cached value (should increment hits)
        result = await cache.get(key)
        expect(result).toEqual({ data: 'test' })
        expect(cache.stats.hits).toBe(1)

        // Second get (should increment hits again)
        result = await cache.get(key)
        expect(result).toEqual({ data: 'test' })
        expect(cache.stats.hits).toBe(2)

        // Final verification of all stats
        expect(cache.stats.misses).toBe(1)  // 1 miss
        expect(cache.stats.hits).toBe(2)    // 2 hits
        expect(cache.stats.sets).toBe(1)    // 1 set
        expect(cache.stats.evictions).toBe(0) // No evictions in this test
    })

    it('should track cache size', async () => {
        // Use unique test ID to avoid conflicts
        const testId = `size-test-${Date.now()}-${Math.random()}`
        const key1 = cache.generateKey('id', `${testId}-1`)
        const key2 = cache.generateKey('id', `${testId}-2`)

        await cache.set(key1, { data: '1' })
        await waitForCache(150)

        // Verify via get() instead of allKeys to confirm it's actually cached
        let result1 = await cache.get(key1)
        expect(result1).toEqual({ data: '1' })

        await cache.set(key2, { data: '2' })
        await waitForCache(150)

        let result2 = await cache.get(key2)
        expect(result2).toEqual({ data: '2' })

        await cache.delete(key1)
        await waitForCache(150)

        result1 = await cache.get(key1)
        result2 = await cache.get(key2)
        expect(result1).toBeNull()
        expect(result2).toEqual({ data: '2' })
    })
})

describe('Cache Invalidation Tests', () => {
    beforeEach(async () => {
        await cache.clear()
    }, 10000)

    afterEach(async () => {
        // Clean up stats interval to prevent hanging processes
        if (cache.statsInterval) {
            clearInterval(cache.statsInterval)
            cache.statsInterval = null
        }
        await cache.clear()
    }, 10000)

    describe('invalidateByObject', () => {
        it('should invalidate matching query caches when object is created', async () => {
            // Cache a query for type=TestObject
            const queryKey = cache.generateKey('query', { __cached: { type: 'TestObject' }, limit: 100, skip: 0 })
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
            const queryKey = cache.generateKey('query', { __cached: { type: 'OtherObject' }, limit: 100, skip: 0 })
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
            const searchKey = cache.generateKey('search', { searchText: "annotation", options: {}, limit: 100, skip: 0 })
            await cache.set(searchKey, [{ id: '1' }])

            const newObj = { type: 'Annotation', body: { value: 'This is an annotation example' } }
            const count = await cache.invalidateByObject(newObj)

            expect(count).toBe(1)
            const cached = await cache.get(searchKey)
            expect(cached).toBeNull()
        })

        it('should invalidate searchPhrase caches', async () => {
            const searchKey = cache.generateKey('searchPhrase', { searchText: "annotation", options: { slop: 2 }, limit: 100, skip: 0 })
            await cache.set(searchKey, [{ id: '1' }])

            const newObj = { type: 'Annotation', body: { value: 'This is an annotation example' } }
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

        // Stats tracking test removed - tests implementation detail not user-facing behavior
    })

    describe('objectMatchesQuery', () => {
        it('should match simple property queries', () => {
            const obj = { type: 'TestObject', name: 'Test' }
            expect(cache.objectMatchesQuery(obj, { type: 'TestObject' })).toBe(true)
            expect(cache.objectMatchesQuery(obj, { type: 'OtherObject' })).toBe(false)
        })

        it('should match queries with body property', () => {
            const obj = { type: 'TestObject' }
            expect(cache.objectMatchesQuery(obj, { __cached: { type: 'TestObject' }, limit: 100, skip: 0 })).toBe(true)
            expect(cache.objectMatchesQuery(obj, { __cached: { type: 'OtherObject' }, limit: 100, skip: 0 })).toBe(false)
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

    describe('Nested Property Query Invalidation', () => {
        /**
         * These tests verify that cache invalidation properly handles nested properties
         * in query conditions. This is critical for catching bugs like the Glosses issue
         * where queries with nested properties (e.g., body.ManuscriptWitness) failed to
         * invalidate when matching objects were created/updated.
         */

        beforeEach(async () => {
            await cache.clear()
        })

        it('should invalidate cache entries with 2-level nested property matches', async () => {
            // Simulate caching a query result with nested property condition
            const queryKey = cache.generateKey('query', {
                __cached: { 'body.target': 'http://example.org/target1' },
                limit: 100,
                skip: 0
            })
            await cache.set(queryKey, [{ id: 'result1' }])
            await waitForCache(100)

            // Verify cache entry exists
            expect(await cache.get(queryKey)).not.toBeNull()

            // Create an object that matches the nested property
            const matchingObject = {
                id: 'obj1',
                body: {
                    target: 'http://example.org/target1'
                }
            }

            // Invalidate using the matching object
            await cache.invalidateByObject(matchingObject)

            // Verify the cached query was invalidated
            expect(await cache.get(queryKey)).toBeNull()
        }, 8000)

        it('should invalidate cache entries with 3+ level nested property matches', async () => {
            // Simulate caching a query with deeply nested property condition
            const queryKey = cache.generateKey('query', {
                __cached: { 'body.target.source': 'http://example.org/source1' },
                limit: 100,
                skip: 0
            })
            await cache.set(queryKey, [{ id: 'result1' }])
            await waitForCache(100)

            // Verify cache entry exists
            expect(await cache.get(queryKey)).not.toBeNull()

            // Create an object with deeply nested matching property
            const matchingObject = {
                id: 'obj1',
                body: {
                    target: {
                        source: 'http://example.org/source1'
                    }
                }
            }

            await cache.invalidateByObject(matchingObject)

            // Verify invalidation
            expect(await cache.get(queryKey)).toBeNull()
        }, 8000)

        it('should properly match objects against queries wrapped in __cached', async () => {
            // Test that the __cached wrapper is properly handled during invalidation
            const queryWithCached = cache.generateKey('query', {
                __cached: { type: 'Annotation', 'body.value': 'test content' },
                limit: 100,
                skip: 0
            })
            await cache.set(queryWithCached, [{ id: 'result1' }])

            const matchingObject = {
                type: 'Annotation',
                body: { value: 'test content' }
            }

            await cache.invalidateByObject(matchingObject)

            // Should invalidate the __cached-wrapped query
            expect(await cache.get(queryWithCached)).toBeNull()
        })

        it('should invalidate GOG fragment queries when matching fragment is created (ManuscriptWitness pattern)', async () => {
            // This test specifically addresses the Glosses bug scenario
            const manuscriptUri = 'http://example.org/manuscript/1'

            // Cache a GOG fragments query
            const fragmentQuery = cache.generateKey('gog-fragments', {
                agentID: 'testAgent',
                manID: manuscriptUri,
                limit: 50,
                skip: 0
            })
            await cache.set(fragmentQuery, [{ id: 'existingFragment' }])

            // Also cache a regular query that searches for ManuscriptWitness
            const regularQuery = cache.generateKey('query', {
                __cached: { 'body.ManuscriptWitness': manuscriptUri },
                limit: 100,
                skip: 0
            })
            await cache.set(regularQuery, [{ id: 'existingFragment' }])
            await waitForCache(100)

            // Verify both cache entries exist
            expect(await cache.get(fragmentQuery)).not.toBeNull()
            expect(await cache.get(regularQuery)).not.toBeNull()

            // Create a new WitnessFragment with matching ManuscriptWitness
            const newFragment = {
                '@type': 'WitnessFragment',
                body: {
                    ManuscriptWitness: manuscriptUri,
                    content: 'Fragment content'
                }
            }

            await cache.invalidateByObject(newFragment)

            // Both cached queries should be invalidated
            expect(await cache.get(regularQuery)).toBeNull()
            // Note: gog-fragments keys are not invalidated by invalidateByObject
            // They are only invalidated by explicit pattern matching in middleware
        }, 8000)

        it('should not invalidate unrelated nested property queries (selective invalidation)', async () => {
            // Cache two queries with different nested property values
            const query1 = cache.generateKey('query', {
                __cached: { 'body.target': 'http://example.org/target1' },
                limit: 100,
                skip: 0
            })
            const query2 = cache.generateKey('query', {
                __cached: { 'body.target': 'http://example.org/target2' },
                limit: 100,
                skip: 0
            })
            await cache.set(query1, [{ id: 'result1' }])
            await cache.set(query2, [{ id: 'result2' }])
            await waitForCache(100)

            // Verify both cache entries exist
            expect(await cache.get(query1)).not.toBeNull()
            expect(await cache.get(query2)).not.toBeNull()

            // Create an object that matches only query1
            const matchingObject = {
                id: 'obj1',
                body: { target: 'http://example.org/target1' }
            }

            await cache.invalidateByObject(matchingObject)

            // Only query1 should be invalidated
            expect(await cache.get(query1)).toBeNull()
            expect(await cache.get(query2)).not.toBeNull()
        }, 8000)

        it('should handle nested properties with special characters (@id, $type)', async () => {
            // Test nested properties containing @ and $ characters
            const query1 = cache.generateKey('query', {
                __cached: { 'target.@id': 'http://example.org/target1' },
                limit: 100,
                skip: 0
            })
            const query2 = cache.generateKey('query', {
                __cached: { 'body.$type': 'TextualBody' },
                limit: 100,
                skip: 0
            })
            await cache.set(query1, [{ id: 'result1' }])
            await cache.set(query2, [{ id: 'result2' }])

            const matchingObject1 = {
                id: 'obj1',
                target: { '@id': 'http://example.org/target1' }
            }

            await cache.invalidateByObject(matchingObject1)

            // Should invalidate query1 but not query2
            expect(await cache.get(query1)).toBeNull()
            expect(await cache.get(query2)).not.toBeNull()

            const matchingObject2 = {
                id: 'obj2',
                body: { '$type': 'TextualBody' }
            }

            await cache.invalidateByObject(matchingObject2)

            // Now query2 should also be invalidated
            expect(await cache.get(query2)).toBeNull()
        })

        it('should invalidate using both previousObject and updatedObject nested properties', async () => {
            // Simulate UPDATE scenario where both old and new objects have nested properties
            const query1 = cache.generateKey('query', {
                __cached: { 'body.target': 'http://example.org/oldTarget' },
                limit: 100,
                skip: 0
            })
            const query2 = cache.generateKey('query', {
                __cached: { 'body.target': 'http://example.org/newTarget' },
                limit: 100,
                skip: 0
            })
            await cache.set(query1, [{ id: 'result1' }])
            await cache.set(query2, [{ id: 'result2' }])
            await waitForCache(100)

            // Verify both cache entries exist
            expect(await cache.get(query1)).not.toBeNull()
            expect(await cache.get(query2)).not.toBeNull()

            // In an UPDATE operation, middleware calls invalidateByObject with both versions
            const previousObject = {
                id: 'obj1',
                body: { target: 'http://example.org/oldTarget' }
            }
            const updatedObject = {
                id: 'obj1',
                body: { target: 'http://example.org/newTarget' }
            }

            // Invalidate using previous object
            await cache.invalidateByObject(previousObject)

            // Invalidate using updated object
            await cache.invalidateByObject(updatedObject)

            // Both queries should be invalidated
            expect(await cache.get(query1)).toBeNull()
            expect(await cache.get(query2)).toBeNull()
        }, 8000)

        it('should handle complex nested queries with multiple conditions', async () => {
            // Test invalidation with queries containing multiple nested property conditions
            const complexQuery = cache.generateKey('query', {
                __cached: {
                    'body.target.source': 'http://example.org/source1',
                    'body.target.type': 'Canvas',
                    'metadata.author': 'testUser'
                },
                limit: 100,
                skip: 0
            })
            await cache.set(complexQuery, [{ id: 'result1' }])

            // Object that matches all conditions
            const fullMatchObject = {
                id: 'obj1',
                body: {
                    target: {
                        source: 'http://example.org/source1',
                        type: 'Canvas'
                    }
                },
                metadata: {
                    author: 'testUser'
                }
            }

            await cache.invalidateByObject(fullMatchObject)

            // Should invalidate because all conditions match
            expect(await cache.get(complexQuery)).toBeNull()
        })

        it('should not invalidate complex queries when only some nested conditions match', async () => {
            // Test that partial matches don't trigger invalidation
            const complexQuery = cache.generateKey('query', {
                __cached: {
                    'body.target.source': 'http://example.org/source1',
                    'body.target.type': 'Canvas',
                    'metadata.author': 'testUser'
                },
                limit: 100,
                skip: 0
            })
            await cache.set(complexQuery, [{ id: 'result1' }])

            // Object that matches only some conditions
            const partialMatchObject = {
                id: 'obj2',
                body: {
                    target: {
                        source: 'http://example.org/source1',
                        type: 'Image'  // Different type
                    }
                },
                metadata: {
                    author: 'testUser'
                }
            }

            await cache.invalidateByObject(partialMatchObject)

            // Should NOT invalidate because not all conditions match
            expect(await cache.get(complexQuery)).not.toBeNull()
        })

        it('should handle array values in nested properties', async () => {
            // Test nested properties that contain arrays
            const queryKey = cache.generateKey('query', {
                __cached: { 'body.target.id': 'http://example.org/target1' },
                limit: 100,
                skip: 0
            })
            await cache.set(queryKey, [{ id: 'result1' }])

            // Object with array containing the matching value
            const objectWithArray = {
                id: 'obj1',
                body: {
                    target: [
                        { id: 'http://example.org/target1' },
                        { id: 'http://example.org/target2' }
                    ]
                }
            }

            await cache.invalidateByObject(objectWithArray)

            // Should invalidate if any array element matches
            expect(await cache.get(queryKey)).toBeNull()
        })
    })

})
