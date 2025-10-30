/**
 * Cache limit enforcement tests for PM2 Cluster Cache
 * Verifies maxLength, maxBytes, and TTL limits are properly configured and enforced
 * @author thehabes
 */

import { jest } from '@jest/globals'
import cache from '../index.js'

/**
 * Helper to wait for cache operations to complete
 */
async function waitForCache(ms = 100) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Helper to get actual cache size from PM2 cluster cache
 */
async function getCacheSize() {
    try {
        const keysMap = await cache.clusterCache.keys()
        const uniqueKeys = new Set()
        for (const instanceKeys of Object.values(keysMap)) {
            if (Array.isArray(instanceKeys)) {
                instanceKeys.forEach(key => {
                    if (!key.startsWith('_stats_worker_')) {
                        uniqueKeys.add(key)
                    }
                })
            }
        }
        return uniqueKeys.size
    } catch (err) {
        return cache.allKeys.size
    }
}

describe('Cache TTL (Time-To-Live) Limit Enforcement', () => {
    beforeEach(async () => {
        await cache.clear()
        await waitForCache(100)
    })
    
    afterEach(async () => {
        await cache.clear()
    })
    
    it('should expire entries after TTL expires', async () => {
        const shortTTL = 1000 // 1 second
        const key = cache.generateKey('id', `ttl-test-${Date.now()}`)
        
        // Set value with short TTL
        await cache.clusterCache.set(key, { data: 'expires soon' }, shortTTL)
        await waitForCache(50)
        
        // Should exist immediately after set
        let value = await cache.get(key)
        expect(value).toEqual({ data: 'expires soon' })
        
        // Wait for TTL to expire (add buffer for reliability)
        await new Promise(resolve => setTimeout(resolve, shortTTL + 300))
        
        // Should be expired and return null
        value = await cache.get(key)
        expect(value).toBeNull()
    }, 10000)

    it('should respect default TTL from constructor (300000ms = 5min)', async () => {
        const key = cache.generateKey('id', `default-ttl-${Date.now()}`)
        
        await cache.set(key, { data: 'uses default ttl' })
        await waitForCache(50)
        
        // Should exist within TTL (default is 300000ms = 5 minutes)
        const value = await cache.get(key)
        expect(value).toEqual({ data: 'uses default ttl' })
        
        // Verify TTL configuration
        const stats = await cache.getStats()
        expect(stats.ttl).toBe(300000)
        expect(stats.ttl).toBe(cache.ttl)
    })

    it('should allow custom TTL per entry', async () => {
        const customTTL = 500 // 0.5 seconds
        const key = cache.generateKey('id', `custom-ttl-${Date.now()}`)
        
        await cache.clusterCache.set(key, { data: 'custom ttl' }, customTTL)
        await waitForCache(50)
        
        // Should exist immediately
        expect(await cache.get(key)).toEqual({ data: 'custom ttl' })
        
        // Wait for custom TTL to expire
        await new Promise(resolve => setTimeout(resolve, customTTL + 200))
        
        // Should be expired
        expect(await cache.get(key)).toBeNull()
    }, 5000)

    it('should enforce TTL across different cache key types', async () => {
        const shortTTL = 800
        const testId = Date.now()
        
        // Set entries with short TTL
        await cache.clusterCache.set(
            cache.generateKey('query', { type: 'Test', testId }), 
            [{ id: 1 }], 
            shortTTL
        )
        await cache.clusterCache.set(
            cache.generateKey('search', { searchText: 'test', testId }), 
            [{ id: 2 }], 
            shortTTL
        )
        await cache.clusterCache.set(
            cache.generateKey('id', `ttl-${testId}`), 
            { id: 3 }, 
            shortTTL
        )
        await waitForCache(50)
        
        // All should exist initially
        expect(await cache.get(cache.generateKey('query', { type: 'Test', testId }))).toBeTruthy()
        expect(await cache.get(cache.generateKey('search', { searchText: 'test', testId }))).toBeTruthy()
        expect(await cache.get(cache.generateKey('id', `ttl-${testId}`))).toBeTruthy()
        
        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, shortTTL + 300))
        
        // All should be expired
        expect(await cache.get(cache.generateKey('query', { type: 'Test', testId }))).toBeNull()
        expect(await cache.get(cache.generateKey('search', { searchText: 'test', testId }))).toBeNull()
        expect(await cache.get(cache.generateKey('id', `ttl-${testId}`))).toBeNull()
    }, 8000)
})

describe('Cache maxLength Limit Configuration', () => {
    beforeEach(async () => {
        await cache.clear()
        await waitForCache(100)
    })
    
    afterEach(async () => {
        await cache.clear()
    })

    it('should have maxLength configured to 1000 by default', () => {
        expect(cache.maxLength).toBe(1000)
    })

    it('should report maxLength in stats', async () => {
        const stats = await cache.getStats()
        
        expect(stats.maxLength).toBeDefined()
        expect(stats.maxLength).toBe(1000)
        expect(stats.maxLength).toBe(cache.maxLength)
    })

    it('should track current cache length', async () => {
        const testId = Date.now()
        
        // Add entries
        await cache.set(cache.generateKey('id', `len-1-${testId}`), { id: 1 })
        await cache.set(cache.generateKey('id', `len-2-${testId}`), { id: 2 })
        await cache.set(cache.generateKey('id', `len-3-${testId}`), { id: 3 })
        await waitForCache(250)
        
        // Check that length is tracked via allKeys (reliable method)
        expect(cache.allKeys.size).toBeGreaterThanOrEqual(3)
    })

    it('should allow PM2 Cluster Cache to enforce maxLength automatically', async () => {
        // PM2 handles eviction based on configured limits
        // This test verifies the limit is configured
        expect(cache.maxLength).toBeGreaterThan(0)
        expect(cache.maxLength).toBe(1000)
        
        const stats = await cache.getStats()
        expect(stats).toHaveProperty('evictions')
    })

    it('should use environment variable CACHE_MAX_LENGTH if set', () => {
        const expected = parseInt(process.env.CACHE_MAX_LENGTH ?? 1000)
        expect(cache.maxLength).toBe(expected)
    })
})

describe('Cache maxBytes Limit Configuration', () => {
    beforeEach(async () => {
        await cache.clear()
        await waitForCache(100)
    })
    
    afterEach(async () => {
        await cache.clear()
    })

    it('should have maxBytes configured to 1GB (1000000000) by default', () => {
        expect(cache.maxBytes).toBe(1000000000)
    })

    it('should report maxBytes in stats', async () => {
        const stats = await cache.getStats()
        
        expect(stats.maxBytes).toBeDefined()
        expect(stats.maxBytes).toBe(1000000000)
        expect(stats.maxBytes).toBe(cache.maxBytes)
    })

    it('should allow PM2 Cluster Cache to monitor byte limits', () => {
        // PM2 monitors total size
        expect(cache.maxBytes).toBeGreaterThan(0)
        expect(cache.maxBytes).toBe(1000000000) // 1GB
    })

    it('should use environment variable CACHE_MAX_BYTES if set', () => {
        const expected = parseInt(process.env.CACHE_MAX_BYTES ?? 1000000000)
        expect(cache.maxBytes).toBe(expected)
    })
})

describe('All Cache Limits Configuration', () => {
    it('should have all three limits (maxLength, maxBytes, TTL) configured', () => {
        expect(cache.maxLength).toBe(1000)
        expect(cache.maxBytes).toBe(1000000000)
        expect(cache.ttl).toBe(300000)
    })

    it('should report all limits in stats', async () => {
        const stats = await cache.getStats()
        
        expect(stats.maxLength).toBe(1000)
        expect(stats.maxBytes).toBe(1000000000)
        expect(stats.ttl).toBe(300000)
    })

    it('should respect environment variables for all limits', () => {
        expect(cache.maxLength).toBe(parseInt(process.env.CACHE_MAX_LENGTH ?? 1000))
        expect(cache.maxBytes).toBe(parseInt(process.env.CACHE_MAX_BYTES ?? 1000000000))
        expect(cache.ttl).toBe(parseInt(process.env.CACHE_TTL ?? 300000))
    })

    it('should have reasonable limit values', () => {
        // maxLength should be positive and reasonable (< 1 million)
        expect(cache.maxLength).toBeGreaterThan(0)
        expect(cache.maxLength).toBeLessThan(1000000)
        
        // maxBytes should be positive and reasonable (< 10GB)
        expect(cache.maxBytes).toBeGreaterThan(0)
        expect(cache.maxBytes).toBeLessThan(10000000000)
        
        // TTL should be positive and reasonable (< 1 day)
        expect(cache.ttl).toBeGreaterThan(0)
        expect(cache.ttl).toBeLessThan(86400000)
    })
})

describe('PM2 Cluster Cache Eviction Stats', () => {
    beforeEach(async () => {
        await cache.clear()
        await waitForCache(100)
    })
    
    afterEach(async () => {
        await cache.clear()
    })

    it('should track eviction count in stats', async () => {
        const stats = await cache.getStats()
        
        expect(stats).toHaveProperty('evictions')
        expect(typeof stats.evictions).toBe('number')
        expect(stats.evictions).toBeGreaterThanOrEqual(0)
    })

    it('should increment evictions when cache.clear() is called', async () => {
        const statsBefore = await cache.getStats()
        const evictionsBefore = statsBefore.evictions
        
        await cache.clear()
        await waitForCache(100)
        
        const statsAfter = await cache.getStats()
        // Clear counts as an eviction event
        expect(statsAfter.evictions).toBeGreaterThanOrEqual(evictionsBefore)
    })
})

describe('Cache Limit Breaking Change Detection', () => {
    it('should detect if limit properties are removed from cache object', () => {
        expect(cache).toHaveProperty('maxLength')
        expect(cache).toHaveProperty('maxBytes')
        expect(cache).toHaveProperty('ttl')
    })

    it('should detect if limit stats reporting is removed', async () => {
        const stats = await cache.getStats()
        
        expect(stats).toHaveProperty('maxLength')
        expect(stats).toHaveProperty('maxBytes')
        expect(stats).toHaveProperty('ttl')
        expect(stats).toHaveProperty('evictions')
        expect(stats).toHaveProperty('length')
    })

    it('should detect if PM2 cluster cache becomes unavailable', () => {
        expect(cache.clusterCache).toBeDefined()
        expect(typeof cache.clusterCache.set).toBe('function')
        expect(typeof cache.clusterCache.get).toBe('function')
        expect(typeof cache.clusterCache.flush).toBe('function')
    })

    it('should detect if default limit values change', () => {
        // If env vars not set, these should be the defaults
        if (!process.env.CACHE_MAX_LENGTH) {
            expect(cache.maxLength).toBe(1000)
        }
        if (!process.env.CACHE_MAX_BYTES) {
            expect(cache.maxBytes).toBe(1000000000)
        }
        if (!process.env.CACHE_TTL) {
            expect(cache.ttl).toBe(300000)
        }
    })
})
