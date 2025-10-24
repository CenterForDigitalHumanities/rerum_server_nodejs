/**
 * Cache limit enforcement tests
 * Verifies that the cache properly enforces maxLength and maxBytes limits
 * @author thehabes
 */

import { jest } from '@jest/globals'
import cache from '../index.js'

/**
 * Helper to create a test cache with custom limits
 * We'll manipulate the singleton cache's limits for testing
 */
function setupTestCache(maxLength, maxBytes, ttl = 300000) {
    cache.clear()
    cache.maxLength = maxLength
    cache.maxBytes = maxBytes
    cache.ttl = ttl
    // Reset stats
    cache.stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        sets: 0,
        invalidations: 0
    }
    return cache
}

/**
 * Helper to restore default cache settings
 */
function restoreDefaultCache() {
    cache.clear()
    cache.maxLength = parseInt(process.env.CACHE_MAX_LENGTH ?? 1000)
    cache.maxBytes = parseInt(process.env.CACHE_MAX_BYTES ?? 1000000000)
    cache.ttl = parseInt(process.env.CACHE_TTL ?? 300000)
    cache.stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        sets: 0,
        invalidations: 0
    }
}

describe('Cache Length Limit Enforcement', () => {
    let testCache
    
    beforeEach(() => {
        testCache = setupTestCache(10, 1000000000, 300000)
    })
    
    afterEach(() => {
        restoreDefaultCache()
    })
    
    it('should not exceed maxLength when adding entries', () => {
        const maxLength = 10
        
        // Add more entries than the limit
        for (let i = 0; i < 20; i++) {
            const key = testCache.generateKey('id', `test${i}`)
            testCache.set(key, { data: `value${i}` })
        }
        
        // Cache should never exceed maxLength
        expect(testCache.cache.size).toBeLessThanOrEqual(maxLength)
        expect(testCache.cache.size).toBe(maxLength)
        
        // Should have evicted the oldest entries
        expect(testCache.stats.evictions).toBe(10)
    })

    it('should evict least recently used entries when limit is reached', () => {
        testCache = setupTestCache(5, 1000000000, 300000)
        
        // Add 5 entries
        for (let i = 0; i < 5; i++) {
            const key = testCache.generateKey('id', `test${i}`)
            testCache.set(key, { data: `value${i}` })
        }
        
        expect(testCache.cache.size).toBe(5)
        
        // Add one more entry, should evict test0
        const key6 = testCache.generateKey('id', 'test5')
        testCache.set(key6, { data: 'value5' })
        
        expect(testCache.cache.size).toBe(5)
        
        // test0 should be evicted (it was the first, least recently used)
        const key0 = testCache.generateKey('id', 'test0')
        const result = testCache.get(key0)
        expect(result).toBeNull()
        
        // test5 should be present
        const result5 = testCache.get(key6)
        expect(result5).toEqual({ data: 'value5' })
    })

    it('should maintain LRU order when accessing entries', () => {
        testCache = setupTestCache(3, 1000000000, 300000)
        
        // Add 3 entries
        const key1 = testCache.generateKey('id', 'test1')
        const key2 = testCache.generateKey('id', 'test2')
        const key3 = testCache.generateKey('id', 'test3')
        
        testCache.set(key1, { data: 'value1' })
        testCache.set(key2, { data: 'value2' })
        testCache.set(key3, { data: 'value3' })
        
        // Access test1 to make it most recently used
        testCache.get(key1)
        
        // Add a new entry, should evict test2 (oldest)
        const key4 = testCache.generateKey('id', 'test4')
        testCache.set(key4, { data: 'value4' })
        
        // test2 should be evicted
        expect(testCache.get(key2)).toBeNull()
        
        // test1 should still be present (was accessed recently)
        expect(testCache.get(key1)).toEqual({ data: 'value1' })
        
        // test3 and test4 should be present
        expect(testCache.get(key3)).toEqual({ data: 'value3' })
        expect(testCache.get(key4)).toEqual({ data: 'value4' })
    })
})

describe('Cache Size (Bytes) Limit Enforcement', () => {
    let testCache
    
    beforeEach(() => {
        testCache = setupTestCache(1000, 500, 300000) // 500 bytes limit
    })
    
    afterEach(() => {
        restoreDefaultCache()
    })
    
    it('should not exceed maxBytes when adding entries', () => {
        // Create entries with known size
        // Each entry will be roughly 50-60 bytes when serialized
        const largeValue = { data: 'x'.repeat(50) }
        
        // Add entries until we exceed the byte limit
        for (let i = 0; i < 20; i++) {
            const key = testCache.generateKey('id', `test${i}`)
            testCache.set(key, largeValue)
        }
        
        // Cache should never exceed maxBytes
        const currentBytes = Buffer.byteLength(JSON.stringify(testCache.cache), 'utf8')
        expect(currentBytes).toBeLessThanOrEqual(500)
        
        // Should have evicted some entries
        expect(testCache.stats.evictions).toBeGreaterThan(0)
    })

    it('should evict multiple entries if needed to stay under byte limit', () => {
        testCache = setupTestCache(1000, 200, 300000) // Very small limit
        
        // Add a few small entries
        for (let i = 0; i < 3; i++) {
            const key = testCache.generateKey('id', `small${i}`)
            testCache.set(key, { data: 'tiny' })
        }
        
        const initialSize = testCache.cache.size
        expect(initialSize).toBeGreaterThan(0)
        
        // Add a large entry that will force multiple evictions
        const largeKey = testCache.generateKey('id', 'large')
        const largeValue = { data: 'x'.repeat(100) }
        testCache.set(largeKey, largeValue)
        
        // Should have evicted entries to make room
        const currentBytes = Buffer.byteLength(JSON.stringify(testCache.cache), 'utf8')
        expect(currentBytes).toBeLessThanOrEqual(200)
    })

    it('should handle byte limit with realistic cache entries', () => {
        testCache = setupTestCache(1000, 5000, 300000) // 5KB limit
        
        // Simulate realistic query cache entries
        const sampleQuery = {
            type: 'Annotation',
            body: {
                value: 'Sample annotation text',
                format: 'text/plain'
            }
        }
        
        const sampleResults = Array.from({ length: 10 }, (_, i) => ({
            '@id': `http://example.org/annotation/${i}`,
            '@type': 'Annotation',
            body: {
                value: `Annotation content ${i}`,
                format: 'text/plain'
            },
            target: `http://example.org/target/${i}`
        }))
        
        // Add multiple query results
        for (let i = 0; i < 10; i++) {
            const key = testCache.generateKey('query', { ...sampleQuery, page: i })
            testCache.set(key, sampleResults)
        }
        
        // Verify byte limit is enforced
        const currentBytes = Buffer.byteLength(JSON.stringify(testCache.cache), 'utf8')
        expect(currentBytes).toBeLessThanOrEqual(5000)
        
        // Should have some entries cached
        expect(testCache.cache.size).toBeGreaterThan(0)
    })
})

describe('Combined Length and Size Limits', () => {
    let testCache
    
    beforeEach(() => {
        testCache = setupTestCache(10, 2000, 300000)
    })
    
    afterEach(() => {
        restoreDefaultCache()
    })
    
    it('should enforce both length and byte limits', () => {
        // Add entries with varying sizes
        for (let i = 0; i < 20; i++) {
            const key = testCache.generateKey('id', `test${i}`)
            const size = i * 10 // Varying sizes
            testCache.set(key, { data: 'x'.repeat(size) })
        }
        
        // Should respect both limits
        expect(testCache.cache.size).toBeLessThanOrEqual(10)
        
        const currentBytes = Buffer.byteLength(JSON.stringify(testCache.cache), 'utf8')
        expect(currentBytes).toBeLessThanOrEqual(2000)
    })

    it('should prioritize byte limit over length limit when necessary', () => {
        testCache = setupTestCache(100, 500, 300000) // High length limit, low byte limit
        
        // Add large entries that will hit byte limit before length limit
        const largeValue = { data: 'x'.repeat(50) }
        
        for (let i = 0; i < 20; i++) {
            const key = testCache.generateKey('id', `test${i}`)
            testCache.set(key, largeValue)
        }
        
        // Should have fewer entries than maxLength due to byte limit
        expect(testCache.cache.size).toBeLessThan(100)
        expect(testCache.cache.size).toBeGreaterThan(0)
        
        // Should respect byte limit
        const currentBytes = Buffer.byteLength(JSON.stringify(testCache.cache), 'utf8')
        expect(currentBytes).toBeLessThanOrEqual(500)
    })
})

describe('Edge Cases', () => {
    let testCache
    
    beforeEach(() => {
        testCache = setupTestCache(5, 1000000000, 300000)
    })
    
    afterEach(() => {
        restoreDefaultCache()
    })
    
    it('should handle updating existing entries without exceeding limits', () => {
        // Fill cache to limit
        for (let i = 0; i < 5; i++) {
            const key = testCache.generateKey('id', `test${i}`)
            testCache.set(key, { data: `value${i}` })
        }
        
        expect(testCache.cache.size).toBe(5)
        
        // Update an existing entry (should not trigger eviction)
        const key2 = testCache.generateKey('id', 'test2')
        testCache.set(key2, { data: 'updated value' })
        
        expect(testCache.cache.size).toBe(5)
        expect(testCache.get(key2)).toEqual({ data: 'updated value' })
    })

    it('should handle single large entry that fits within limits', () => {
        testCache = setupTestCache(1000, 1000, 300000)
        
        // Add a large but valid entry
        const largeKey = testCache.generateKey('id', 'large')
        const largeValue = { data: 'x'.repeat(200) }
        testCache.set(largeKey, largeValue)
        
        expect(testCache.cache.size).toBe(1)
        expect(testCache.get(largeKey)).toEqual(largeValue)
    })

    it('should handle empty cache when checking limits', () => {
        testCache = setupTestCache(10, 1000, 300000)
        
        expect(testCache.cache.size).toBe(0)
        
        const stats = testCache.getStats()
        expect(stats.length).toBe(0)
        expect(stats.maxLength).toBe(10)
        expect(stats.maxBytes).toBe(1000)
    })
})

describe('Real-world Simulation', () => {
    let testCache
    
    beforeEach(() => {
        // Use actual default values from production
        testCache = setupTestCache(1000, 1000000000, 300000)
    })
    
    afterEach(() => {
        restoreDefaultCache()
    })
    
    it('should handle realistic RERUM API cache usage', () => {
        // Simulate 2000 cache operations (should trigger evictions)
        for (let i = 0; i < 2000; i++) {
            const key = testCache.generateKey('query', {
                type: 'Annotation',
                '@context': 'http://www.w3.org/ns/anno.jsonld',
                page: Math.floor(i / 10)
            })
            
            // Realistic result set
            const results = Array.from({ length: 100 }, (_, j) => ({
                '@id': `http://store.rerum.io/v1/id/${i}_${j}`,
                '@type': 'Annotation'
            }))
            
            testCache.set(key, results)
        }
        
        // Should respect length limit
        expect(testCache.cache.size).toBeLessThanOrEqual(1000)
        
        // Due to the page grouping (Math.floor(i/10)), we actually only have 200 unique keys
        // (2000 / 10 = 200 unique page numbers)
        // So the final cache size should be 200, not 1000
        expect(testCache.cache.size).toBe(200)
        
        // No evictions should occur because we only created 200 unique entries
        // (Each i/10 page gets overwritten 10 times, not added)
        expect(testCache.stats.evictions).toBe(0)
        
        // Stats should show 2000 sets (including overwrites)
        const stats = testCache.getStats()
        expect(stats.sets).toBe(2000)
        expect(stats.length).toBe(200)
        
        // Verify byte limit is not exceeded
        expect(stats.bytes).toBeLessThanOrEqual(1000000000)
    })
})

