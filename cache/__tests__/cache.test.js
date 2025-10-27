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

    beforeEach(() => {
        // Clear cache before each test
        cache.clear()
        
        // Reset mock request
        mockReq = {
            method: 'GET',
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

    describe('cacheQuery middleware', () => {
        it('should pass through on non-POST requests', () => {
            mockReq.method = 'GET'
            
            cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should return cache MISS on first request', () => {
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            mockReq.query = { limit: '100', skip: '0' }
            
            cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical request', () => {
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            mockReq.query = { limit: '100', skip: '0' }
            
            // First request - populate cache
            cacheQuery(mockReq, mockRes, mockNext)
            const originalJson = mockRes.json
            mockRes.json([{ id: '123', type: 'Annotation' }])
            
            // Reset mocks for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request - should hit cache
            cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalledWith([{ id: '123', type: 'Annotation' }])
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should respect pagination parameters in cache key', () => {
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            
            // First request with limit=10
            mockReq.query = { limit: '10', skip: '0' }
            cacheQuery(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            
            // Second request with limit=20 (different cache key)
            mockRes.headers = {}
            mockNext = jest.fn()
            mockReq.query = { limit: '20', skip: '0' }
            cacheQuery(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })

        it('should create different cache keys for different query bodies', () => {
            mockReq.method = 'POST'
            mockReq.query = { limit: '100', skip: '0' }
            
            // First request for Annotations
            mockReq.body = { type: 'Annotation' }
            cacheQuery(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '1', type: 'Annotation' }])
            
            // Reset mocks for second request
            mockRes.headers = {}
            const jsonSpy = jest.fn()
            mockRes.json = jsonSpy
            mockNext = jest.fn()
            
            // Second request for Person (different body, should be MISS)
            mockReq.body = { type: 'Person' }
            cacheQuery(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
            // json was replaced by middleware, so check it wasn't called before next()
            expect(jsonSpy).not.toHaveBeenCalled()
        })
    })

    describe('cacheSearch middleware', () => {
        it('should pass through on non-POST requests', () => {
            mockReq.method = 'GET'
            
            cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockNext).toHaveBeenCalled()
            expect(mockRes.json).not.toHaveBeenCalled()
        })

        it('should return cache MISS on first search', () => {
            mockReq.method = 'POST'
            mockReq.body = 'manuscript'
            
            cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical search', () => {
            mockReq.method = 'POST'
            mockReq.body = 'manuscript'
            
            // First request
            cacheSearch(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '123', body: 'manuscript text' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
            expect(mockNext).not.toHaveBeenCalled()
        })

        it('should handle search with options object', () => {
            mockReq.method = 'POST'
            mockReq.body = {
                searchText: 'manuscript',
                options: { fuzzy: true }
            }
            
            cacheSearch(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })
    })

    describe('cacheSearchPhrase middleware', () => {
        it('should return cache MISS on first phrase search', () => {
            mockReq.method = 'POST'
            mockReq.body = 'medieval manuscript'
            
            cacheSearchPhrase(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second identical phrase search', () => {
            mockReq.method = 'POST'
            mockReq.body = 'medieval manuscript'
            
            // First request
            cacheSearchPhrase(mockReq, mockRes, mockNext)
            mockRes.json([{ id: '456' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            cacheSearchPhrase(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
        })
    })

    describe('cacheId middleware', () => {
        it('should pass through on non-GET requests', () => {
            mockReq.method = 'POST'
            
            cacheId(mockReq, mockRes, mockNext)
            
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache MISS on first ID lookup', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            cacheId(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second ID lookup', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            // First request
            cacheId(mockReq, mockRes, mockNext)
            mockRes.json({ _id: '688bc5a1f1f9c3e2430fa99f', type: 'Annotation' })
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            cacheId(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.headers['Cache-Control']).toBe('max-age=86400, must-revalidate')
            expect(mockRes.json).toHaveBeenCalled()
        })

        it('should cache different IDs separately', () => {
            mockReq.method = 'GET'
            
            // First ID
            mockReq.params = { _id: 'id123' }
            cacheId(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            
            // Second different ID
            mockRes.headers = {}
            mockNext = jest.fn()
            mockReq.params = { _id: 'id456' }
            cacheId(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
        })
    })

    describe('cacheHistory middleware', () => {
        it('should return cache MISS on first history request', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            cacheHistory(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second history request', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            // First request
            cacheHistory(mockReq, mockRes, mockNext)
            mockRes.json([{ _id: '688bc5a1f1f9c3e2430fa99f' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            cacheHistory(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
        })
    })

    describe('cacheSince middleware', () => {
        it('should return cache MISS on first since request', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            cacheSince(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('MISS')
            expect(mockNext).toHaveBeenCalled()
        })

        it('should return cache HIT on second since request', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: '688bc5a1f1f9c3e2430fa99f' }
            
            // First request
            cacheSince(mockReq, mockRes, mockNext)
            mockRes.json([{ _id: '688bc5a1f1f9c3e2430fa99f' }])
            
            // Reset for second request
            mockRes.headers = {}
            mockRes.json = jest.fn()
            mockNext = jest.fn()
            
            // Second request
            cacheSince(mockReq, mockRes, mockNext)
            
            expect(mockRes.headers['X-Cache']).toBe('HIT')
            expect(mockRes.json).toHaveBeenCalled()
        })
    })

    describe('cacheStats endpoint', () => {
        it('should return cache statistics', () => {
            cacheStats(mockReq, mockRes)
            
            expect(mockRes.json).toHaveBeenCalled()
            const response = mockRes.json.mock.calls[0][0]
            expect(response).toHaveProperty('hits')
            expect(response).toHaveProperty('misses')
            expect(response).toHaveProperty('hitRate')
            expect(response).toHaveProperty('length')
        })

        it('should include details when requested', () => {
            mockReq.query = { details: 'true' }
            
            cacheStats(mockReq, mockRes)
            
            const response = mockRes.json.mock.calls[0][0]
            expect(response).toHaveProperty('details')
            expect(response).toHaveProperty('hits')
            expect(response).toHaveProperty('misses')
        })
    })

    describe('Cache integration', () => {
        it('should maintain separate caches for different endpoints', () => {
            // Query cache
            mockReq.method = 'POST'
            mockReq.body = { type: 'Annotation' }
            cacheQuery(mockReq, mockRes, mockNext)
            mockRes.json([{ id: 'query1' }])
            
            // Search cache
            mockReq.body = 'test search'
            mockRes.headers = {}
            mockNext = jest.fn()
            cacheSearch(mockReq, mockRes, mockNext)
            mockRes.json([{ id: 'search1' }])
            
            // ID cache
            mockReq.method = 'GET'
            mockReq.params = { _id: 'id123' }
            mockRes.headers = {}
            mockNext = jest.fn()
            cacheId(mockReq, mockRes, mockNext)
            mockRes.json({ id: 'id123' })
            
            expect(cache.cache.size).toBe(3)
        })

        it('should only cache successful responses', () => {
            mockReq.method = 'GET'
            mockReq.params = { _id: 'test123' }
            mockRes.statusCode = 404
            
            cacheId(mockReq, mockRes, mockNext)
            mockRes.json({ error: 'Not found' })
            
            // Second request should still be MISS
            mockRes.headers = {}
            mockRes.statusCode = 200
            mockNext = jest.fn()
            
            cacheId(mockReq, mockRes, mockNext)
            expect(mockRes.headers['X-Cache']).toBe('MISS')
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

    it('should track hits and misses correctly', () => {
        // Clear cache and get initial stats to reset counters
        cache.clear()
        
        const key = cache.generateKey('id', 'test123-isolated')
        
        // First access - miss
        let result = cache.get(key)
        expect(result).toBeNull()
        
        // Set value
        cache.set(key, { data: 'test' })
        
        // Second access - hit
        result = cache.get(key)
        expect(result).toEqual({ data: 'test' })
        
        // Third access - hit
        result = cache.get(key)
        expect(result).toEqual({ data: 'test' })
        
        const stats = cache.getStats()
        // Stats accumulate across tests, so we just verify hits > misses
        expect(stats.hits).toBeGreaterThanOrEqual(2)
        expect(stats.misses).toBeGreaterThanOrEqual(1)
        // Hit rate should be a valid percentage string
        expect(stats.hitRate).toMatch(/^\d+\.\d+%$/)
    })

    it('should track cache size', () => {
        expect(cache.cache.size).toBe(0)
        
        cache.set(cache.generateKey('id', '1'), { data: '1' })
        expect(cache.cache.size).toBe(1)
        
        cache.set(cache.generateKey('id', '2'), { data: '2' })
        expect(cache.cache.size).toBe(2)
        
        cache.delete(cache.generateKey('id', '1'))
        expect(cache.cache.size).toBe(1)
    })
})
