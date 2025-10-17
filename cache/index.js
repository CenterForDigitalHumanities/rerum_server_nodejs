#!/usr/bin/env node

/**
 * In-memory LRU cache implementation for RERUM API
 * Caches query, search, and id lookup results to reduce MongoDB Atlas load
 * @author Claude Sonnet 4
 */

/**
 * Represents a node in the doubly-linked list used by LRU cache
 */
class CacheNode {
    constructor(key, value) {
        this.key = key
        this.value = value
        this.prev = null
        this.next = null
        this.timestamp = Date.now()
        this.hits = 0
    }
}

/**
 * LRU (Least Recently Used) Cache implementation
 * Features:
 * - Fixed size limit with automatic eviction
 * - O(1) get and set operations
 * - TTL (Time To Live) support for cache entries
 * - Statistics tracking (hits, misses, evictions)
 * - Pattern-based invalidation for cache clearing
 */
class LRUCache {
    constructor(maxSize = 1000, ttl = 300000) { // Default: 1000 entries, 5 minutes TTL
        this.maxSize = maxSize
        this.ttl = ttl // Time to live in milliseconds
        this.cache = new Map()
        this.head = null // Most recently used
        this.tail = null // Least recently used
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0,
            invalidations: 0
        }
    }

    /**
     * Generate a cache key from request parameters
     * @param {string} type - Type of request (query, search, searchPhrase, id)
     * @param {Object|string} params - Request parameters or ID
     * @returns {string} Cache key
     */
    generateKey(type, params) {
        if (type === 'id') {
            return `id:${params}`
        }
        // For query and search, create a stable key from the params object
        const sortedParams = JSON.stringify(params, Object.keys(params).sort())
        return `${type}:${sortedParams}`
    }

    /**
     * Move node to head of list (mark as most recently used)
     */
    moveToHead(node) {
        if (node === this.head) return

        // Remove from current position
        if (node.prev) node.prev.next = node.next
        if (node.next) node.next.prev = node.prev
        if (node === this.tail) this.tail = node.prev

        // Move to head
        node.prev = null
        node.next = this.head
        if (this.head) this.head.prev = node
        this.head = node
        if (!this.tail) this.tail = node
    }

    /**
     * Remove tail node (least recently used)
     */
    removeTail() {
        if (!this.tail) return null

        const node = this.tail
        this.cache.delete(node.key)
        
        if (this.tail.prev) {
            this.tail = this.tail.prev
            this.tail.next = null
        } else {
            this.head = null
            this.tail = null
        }

        this.stats.evictions++
        return node
    }

    /**
     * Check if cache entry is expired
     */
    isExpired(node) {
        return (Date.now() - node.timestamp) > this.ttl
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {*} Cached value or null if not found/expired
     */
    get(key) {
        const node = this.cache.get(key)
        
        if (!node) {
            this.stats.misses++
            return null
        }

        // Check if expired
        if (this.isExpired(node)) {
            this.delete(key)
            this.stats.misses++
            return null
        }

        // Move to head (most recently used)
        this.moveToHead(node)
        node.hits++
        this.stats.hits++
        
        return node.value
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    set(key, value) {
        this.stats.sets++

        // Check if key already exists
        if (this.cache.has(key)) {
            const node = this.cache.get(key)
            node.value = value
            node.timestamp = Date.now()
            this.moveToHead(node)
            return
        }

        // Create new node
        const newNode = new CacheNode(key, value)
        this.cache.set(key, newNode)

        // Add to head
        newNode.next = this.head
        if (this.head) this.head.prev = newNode
        this.head = newNode
        if (!this.tail) this.tail = newNode

        // Check size limit
        if (this.cache.size > this.maxSize) {
            this.removeTail()
        }
    }

    /**
     * Delete specific key from cache
     * @param {string} key - Cache key to delete
     */
    delete(key) {
        const node = this.cache.get(key)
        if (!node) return false

        // Remove from list
        if (node.prev) node.prev.next = node.next
        if (node.next) node.next.prev = node.prev
        if (node === this.head) this.head = node.next
        if (node === this.tail) this.tail = node.prev

        this.cache.delete(key)
        return true
    }

    /**
     * Invalidate cache entries matching a pattern
     * Used for cache invalidation after writes
     * @param {string|RegExp} pattern - Pattern to match keys against
     */
    invalidate(pattern) {
        const keysToDelete = []
        
        if (typeof pattern === 'string') {
            // Simple string matching
            for (const key of this.cache.keys()) {
                if (key.includes(pattern)) {
                    keysToDelete.push(key)
                }
            }
        } else if (pattern instanceof RegExp) {
            // Regex matching
            for (const key of this.cache.keys()) {
                if (pattern.test(key)) {
                    keysToDelete.push(key)
                }
            }
        }

        keysToDelete.forEach(key => this.delete(key))
        this.stats.invalidations += keysToDelete.length
        
        return keysToDelete.length
    }

    /**
     * Invalidate cache for a specific object ID
     * This clears the ID cache and any query/search results that might contain it
     * @param {string} id - Object ID to invalidate
     */
    invalidateById(id) {
        const idKey = `id:${id}`
        let count = 0
        
        // Delete direct ID cache
        if (this.delete(idKey)) {
            count++
        }

        // Invalidate all queries and searches (conservative approach)
        // In a production environment, you might want to be more selective
        count += this.invalidate(/^(query|search|searchPhrase):/)
        
        this.stats.invalidations += count
        return count
    }

    /**
     * Clear all cache entries
     */
    clear() {
        const size = this.cache.size
        this.cache.clear()
        this.head = null
        this.tail = null
        this.stats.invalidations += size
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0

        return {
            ...this.stats,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: `${hitRate}%`,
            ttl: this.ttl
        }
    }

    /**
     * Get detailed information about cache entries
     * Useful for debugging
     */
    getDetails() {
        const entries = []
        let current = this.head
        let position = 0

        while (current) {
            entries.push({
                position,
                key: current.key,
                age: Date.now() - current.timestamp,
                hits: current.hits,
                size: JSON.stringify(current.value).length
            })
            current = current.next
            position++
        }

        return entries
    }
}

// Create singleton cache instance
// Configuration can be adjusted via environment variables
const CACHE_MAX_SIZE = parseInt(process.env.CACHE_MAX_SIZE ?? 1000)
const CACHE_TTL = parseInt(process.env.CACHE_TTL ?? 300000) // 5 minutes default

const cache = new LRUCache(CACHE_MAX_SIZE, CACHE_TTL)

// Export cache instance and class
export { cache, LRUCache }
export default cache
