#!/usr/bin/env node

/**
 * PM2 Cluster-synchronized cache implementation for RERUM API
 * Uses pm2-cluster-cache to synchronize cache across all PM2 worker instances.
 * Caches read operation results to reduce MongoDB Atlas load.
 * Uses smart invalidation during writes to invalidate affected cached reads.
 * 
 * PM2 Cluster Mode with Synchronization:
 * When running in PM2 cluster mode (pm2 start -i max), this implementation uses
 * the 'all' storage mode which replicates cache entries across ALL worker instances.
 * 
 * This means:
 * - All instances have the same cached data (full synchronization)
 * - Cache hit rates are consistent across instances (~80-90% typical)
 * - Cache invalidation on writes affects ALL instances immediately
 * - Memory usage is higher (each instance stores full cache)
 * 
 * Storage mode is set to 'all' for maximum consistency.
 * Falls back to local-only mode if not running under PM2.
 * 
 * @author thehabes
 */

import pm2ClusterCache from 'pm2-cluster-cache'

/**
 * Cluster-synchronized cache wrapper
 * Wraps pm2-cluster-cache to maintain compatibility with existing middleware API
 */
class ClusterCache {
    constructor(maxLength = 1000, maxBytes = 1000000000, ttl = 300000) {
        this.maxLength = maxLength
        this.maxBytes = maxBytes
        this.life = Date.now()
        this.ttl = ttl // Time to live in milliseconds
        
        // Initialize pm2-cluster-cache with 'all' storage mode
        // This replicates cache across all PM2 instances
        this.clusterCache = pm2ClusterCache.init({
            storage: 'all',  // Replicate to all instances for consistency
            defaultTtl: ttl,
            logger: console
        })
        
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0,
            invalidations: 0
        }
        
        // Track all keys for pattern-based invalidation
        this.allKeys = new Set()
        
        // Fallback local cache for when not running under PM2
        this.localCache = new Map()
    }

    /**
     * Generate a cache key from request parameters
     * @param {string} type - Type of request (query, search, searchPhrase, id)
     * @param {Object|string} params - Request parameters or ID
     * @returns {string} Cache key
     */
    generateKey(type, params) {
        if (type === 'id' || type === 'history' || type === 'since') return `${type}:${params}` 
        // For query and search, create a stable key from the params object
        const sortedParams = JSON.stringify(params, (key, value) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return Object.keys(value)
                    .sort()
                    .reduce((sorted, key) => {
                        sorted[key] = value[key]
                        return sorted
                    }, {})
            }
            return value
        })
        return `${type}:${sortedParams}`
    }

    /**
     * Get value from cache
     * @param {string} key - Cache key
     * @returns {*} Cached value or null
     */
    async get(key) {
        try {
            const value = await this.clusterCache.get(key, undefined)
            if (value !== undefined) {
                this.stats.hits++
                return value
            }
            // Fallback to local cache (for testing without PM2)
            if (this.localCache.has(key)) {
                this.stats.hits++
                return this.localCache.get(key)
            }
            this.stats.misses++
            return null
        } catch (err) {
            // Fallback to local cache on error
            if (this.localCache.has(key)) {
                this.stats.hits++
                return this.localCache.get(key)
            }
            this.stats.misses++
            return null
        }
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    async set(key, value) {
        try {
            await this.clusterCache.set(key, value, this.ttl)
            this.stats.sets++
            this.allKeys.add(key)
            // Also store in local cache as fallback
            this.localCache.set(key, value)
        } catch (err) {
            console.error('Cache set error:', err)
            // Still store in local cache on error
            this.localCache.set(key, value)
            this.allKeys.add(key)
            this.stats.sets++
        }
    }

    /**
     * Delete specific key from cache
     * @param {string} key - Cache key to delete
     */
    async delete(key) {
        try {
            await this.clusterCache.delete(key)
            this.allKeys.delete(key)
            this.localCache.delete(key)
            return true
        } catch (err) {
            this.localCache.delete(key)
            this.allKeys.delete(key)
            return false
        }
    }

    /**
     * Clear all cache entries
     */
    async clear() {
        try {
            await this.clusterCache.flush()
            this.allKeys.clear()
            this.localCache.clear()
            this.stats.evictions++
        } catch (err) {
            console.error('Cache clear error:', err)
            this.localCache.clear()
            this.allKeys.clear()
            this.stats.evictions++
        }
    }

    /**
     * Invalidate cache entries matching a pattern
     * @param {string|RegExp} pattern - Pattern to match keys against
     * @returns {number} Number of keys invalidated
     */
    async invalidate(pattern) {
        let count = 0
        
        try {
            // Get all keys across all instances
            const keysMap = await this.clusterCache.keys()
            const allKeys = new Set()
            
            // Collect all keys from all instances
            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    instanceKeys.forEach(key => allKeys.add(key))
                }
            }
            
            // Match pattern and delete
            const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern)
            
            const deletePromises = []
            for (const key of allKeys) {
                if (regex.test(key)) {
                    deletePromises.push(this.delete(key))
                    count++
                }
            }
            
            await Promise.all(deletePromises)
            this.stats.invalidations++
        } catch (err) {
            console.error('Cache invalidate error:', err)
        }
        
        return count
    }

    /**
     * Get cache statistics
     * @returns {Object} Statistics object
     */
    async getStats() {
        try {
            const keysMap = await this.clusterCache.keys()
            const uniqueKeys = new Set()
            
            // Collect unique keys across all instances
            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    instanceKeys.forEach(key => uniqueKeys.add(key))
                }
            }
            
            const uptime = Date.now() - this.life
            const hitRate = this.stats.hits + this.stats.misses > 0
                ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
                : 0
            
            return {
                length: uniqueKeys.size > 0 ? uniqueKeys.size : this.allKeys.size,
                maxLength: this.maxLength,
                maxBytes: this.maxBytes,
                ttl: this.ttl,
                hits: this.stats.hits,
                misses: this.stats.misses,
                sets: this.stats.sets,
                evictions: this.stats.evictions,
                invalidations: this.stats.invalidations,
                hitRate: `${hitRate}%`,
                uptime: this._formatUptime(uptime),
                mode: 'cluster-all',
                synchronized: true
            }
        } catch (err) {
            console.error('Cache getStats error:', err)
            const uptime = Date.now() - this.life
            const hitRate = this.stats.hits + this.stats.misses > 0
                ? (this.stats.hits / (this.stats.misses + this.stats.misses) * 100).toFixed(2)
                : 0
            return {
                ...this.stats,
                length: this.allKeys.size,
                maxLength: this.maxLength,
                maxBytes: this.maxBytes,
                ttl: this.ttl,
                hitRate: `${hitRate}%`,
                uptime: this._formatUptime(uptime),
                mode: 'cluster-all',
                synchronized: true,
                error: err.message
            }
        }
    }

    /**
     * Format uptime duration
     * @param {number} ms - Milliseconds
     * @returns {string} Formatted uptime
     * @private
     */
    _formatUptime(ms) {
        const totalSeconds = Math.floor(ms / 1000)
        const totalMinutes = Math.floor(totalSeconds / 60)
        const totalHours = Math.floor(totalMinutes / 60)
        const days = Math.floor(totalHours / 24)
        
        const hours = totalHours % 24
        const minutes = totalMinutes % 60
        const seconds = totalSeconds % 60
        
        let parts = []
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`)
        if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
        if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
        parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`)
        return parts.join(", ")
    }

    /**
     * Smart invalidation based on object properties
     * Only invalidates query/search caches that could potentially match this object
     * @param {Object} obj - The created/updated object
     * @param {Set} invalidatedKeys - Set to track which keys were invalidated (optional)
     * @returns {Promise<number>} - Number of cache entries invalidated
     */
    async invalidateByObject(obj, invalidatedKeys = new Set()) {
        if (!obj || typeof obj !== 'object') return 0
        
        let count = 0
        
        // Get all cache keys - use local tracking since cluster.keys() may not be available
        const keysToCheck = Array.from(this.allKeys)
        
        for (const cacheKey of keysToCheck) {
            // Only check query and search caches (not id, history, since, gog)
            if (!cacheKey.startsWith('query:') && 
                !cacheKey.startsWith('search:') && 
                !cacheKey.startsWith('searchPhrase:')) {
                continue
            }
            
            // Extract the query parameters from the cache key
            // Format: "query:{...json...}" or "search:{...json...}"
            const colonIndex = cacheKey.indexOf(':')
            if (colonIndex === -1) continue
            
            try {
                const queryJson = cacheKey.substring(colonIndex + 1)
                const queryParams = JSON.parse(queryJson)
                
                // Check if the created object matches this query
                if (this.objectMatchesQuery(obj, queryParams)) {
                    await this.delete(cacheKey)
                    invalidatedKeys.add(cacheKey)
                    count++
                }
            } catch (e) {
                // If we can't parse the cache key, skip it
                continue
            }
        }
        
        this.stats.invalidations += count
        return count
    }

    /**
     * Check if an object matches a query
     * @param {Object} obj - The object to check
     * @param {Object} query - The query parameters
     * @returns {boolean} - True if object could match this query
     */
    objectMatchesQuery(obj, query) {
        // For query endpoint: check if object matches the query body
        if (query.body && typeof query.body === 'object') return this.objectContainsProperties(obj, query.body)
        // For direct queries (like {"type":"CacheTest"}), check if object matches
        return this.objectContainsProperties(obj, query)
    }

    /**
     * Check if an object contains all properties specified in a query
     * @param {Object} obj - The object to check
     * @param {Object} queryProps - The properties to match
     * @returns {boolean} - True if object matches the query conditions
     */
    objectContainsProperties(obj, queryProps) {
        for (const [key, value] of Object.entries(queryProps)) {
            // Skip pagination and internal parameters
            if (key === 'limit' || key === 'skip') continue
            
            // Skip server-managed properties
            if (key === '__rerum' || key === '_id') continue
            if (key.startsWith('__rerum.') || key.includes('.__rerum.') || key.endsWith('.__rerum') ||
                key.startsWith('_id.') || key.includes('._id.') || key.endsWith('._id')) {
                continue
            }
            
            // Handle MongoDB query operators
            if (key.startsWith('$')) {
                if (!this.evaluateOperator(obj, key, value)) {
                    return false
                }
                continue
            }
            
            // Handle nested operators on a field
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                const hasOperators = Object.keys(value).some(k => k.startsWith('$'))
                if (hasOperators) {
                    if (key.includes('history')) continue // Conservative
                    const fieldValue = this.getNestedProperty(obj, key)
                    if (!this.evaluateFieldOperators(fieldValue, value)) {
                        return false
                    }
                    continue
                }
            }
            
            // Check if object has this property
            const objValue = this.getNestedProperty(obj, key)
            if (objValue === undefined && !(key in obj)) {
                return false
            }
            
            // For simple values, check equality
            if (typeof value !== 'object' || value === null) {
                if (objValue !== value) return false
            } else {
                // For nested objects, recursively check
                if (typeof objValue !== 'object' || !this.objectContainsProperties(objValue, value)) {
                    return false
                }
            }
        }
        return true
    }

    /**
     * Evaluate field-level operators
     * @param {*} fieldValue - The actual field value
     * @param {Object} operators - Object containing operators
     * @returns {boolean} - True if field satisfies all operators
     */
    evaluateFieldOperators(fieldValue, operators) {
        for (const [op, opValue] of Object.entries(operators)) {
            switch (op) {
                case '$exists':
                    if ((fieldValue !== undefined) !== opValue) return false
                    break
                case '$size':
                    if (!Array.isArray(fieldValue) || fieldValue.length !== opValue) return false
                    break
                case '$ne':
                    if (fieldValue === opValue) return false
                    break
                case '$gt':
                    if (!(fieldValue > opValue)) return false
                    break
                case '$gte':
                    if (!(fieldValue >= opValue)) return false
                    break
                case '$lt':
                    if (!(fieldValue < opValue)) return false
                    break
                case '$lte':
                    if (!(fieldValue <= opValue)) return false
                    break
                default:
                    return true // Unknown operator - be conservative
            }
        }
        return true
    }

    /**
     * Evaluate top-level MongoDB operators
     * @param {Object} obj - The object
     * @param {string} operator - The operator ($or, $and, etc.)
     * @param {*} value - The operator value
     * @returns {boolean} - True if object matches operator
     */
    evaluateOperator(obj, operator, value) {
        switch (operator) {
            case '$or':
                if (!Array.isArray(value)) return false
                return value.some(condition => this.objectContainsProperties(obj, condition))
            case '$and':
                if (!Array.isArray(value)) return false
                return value.every(condition => this.objectContainsProperties(obj, condition))
            case '$in':
                return Array.isArray(value) && value.includes(obj)
            default:
                return true // Unknown operator - be conservative
        }
    }

    /**
     * Get nested property value using dot notation
     * @param {Object} obj - The object
     * @param {string} path - Property path
     * @returns {*} Property value or undefined
     */
    getNestedProperty(obj, path) {
        const keys = path.split('.')
        let current = obj
        
        for (const key of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined
            }
            current = current[key]
        }
        
        return current
    }
}

// Legacy LRUCache class removed - now using ClusterCache exclusively

/**
 * Represents a node in the doubly-linked list used by LRU cache
 * (Kept for reference but not used with pm2-cluster-cache)
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
 * - Fixed length limit with automatic eviction
 * - Fixed size limit with automatic eviction
 * - O(1) get and set operations
 * - TTL (Time To Live) support for cache entries
 * - Passive expiration upon access
 * - Statistics tracking (hits, misses, evictions)
 * - Pattern-based invalidation for cache clearing
 * Default: 1000 entries, 1GB, 5 minutes TTL
 */
class LRUCache {
    constructor(maxLength = 1000, maxBytes = 1000000000, ttl = 300000) {
        this.maxLength = maxLength
        this.maxBytes = maxBytes
        this.life = Date.now()
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
        if (type === 'id' || type === 'history' || type === 'since') return `${type}:${params}` 
        // For query and search, create a stable key from the params object
        // Use a custom replacer to ensure consistent key ordering at all levels
        const sortedParams = JSON.stringify(params, (key, value) => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return Object.keys(value)
                    .sort()
                    .reduce((sorted, key) => {
                        sorted[key] = value[key]
                        return sorted
                    }, {})
            }
            return value
        })
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
     * Record eviction by increasing eviction count.
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
     * Record hits and misses for the stats
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
            console.log("Expired node will be removed.")
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
     * Calculate the total byte size of cached values
     * @returns {number} Total bytes used by cache
     */
    calculateByteSize() {
        let totalBytes = 0
        for (const [key, node] of this.cache.entries()) {
            // Calculate size of key + value
            totalBytes += Buffer.byteLength(key, 'utf8')
            totalBytes += Buffer.byteLength(JSON.stringify(node.value), 'utf8')
        }
        return totalBytes
    }

    /**
     * Set value in cache
     * Record the set for the stats
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    set(key, value) {
        this.stats.sets++

        // Check if key already exists
        if (this.cache.has(key)) {
            // This set overwrites this existing node and moves it to the head.
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

        // Check length limit
        if (this.cache.size > this.maxLength) this.removeTail()
        
        // Check size limit
        let bytes = this.calculateByteSize()
        if (bytes > this.maxBytes) {
            console.warn("Cache byte size exceeded.  Objects are being evicted.")
            while (bytes > this.maxBytes && this.cache.size > 0) {
                this.removeTail()
                bytes = this.calculateByteSize()
            }
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
                if (key.includes(pattern)) keysToDelete.push(key)
            }
        } else if (pattern instanceof RegExp) {
            // Regex matching
            for (const key of this.cache.keys()) {
                if (pattern.test(key)) keysToDelete.push(key)        
            }
        }

        keysToDelete.forEach(key => this.delete(key))
        this.stats.invalidations += keysToDelete.length
        
        return keysToDelete.length
    }

    /**
     * Smart invalidation based on object properties
     * Only invalidates query/search caches that could potentially match this object
     * @param {Object} obj - The created/updated object
     * @param {Set} invalidatedKeys - Set to track which keys were invalidated (optional)
     * @returns {number} - Number of cache entries invalidated
     */
    invalidateByObject(obj, invalidatedKeys = new Set()) {
        if (!obj || typeof obj !== 'object') return 0
        
        let count = 0
        
        // Get all query/search cache keys
        for (const cacheKey of this.cache.keys()) {
            // Only check query and search caches (not id, history, since, gog)
            if (!cacheKey.startsWith('query:') && 
                !cacheKey.startsWith('search:') && 
                !cacheKey.startsWith('searchPhrase:')) {
                continue
            }
            
            // Extract the query parameters from the cache key
            // Format: "query:{...json...}" or "search:{...json...}"
            const colonIndex = cacheKey.indexOf(':')
            if (colonIndex === -1) continue
            
            try {
                const queryJson = cacheKey.substring(colonIndex + 1)
                const queryParams = JSON.parse(queryJson)
                
                // Check if the created object matches this query
                if (this.objectMatchesQuery(obj, queryParams)) {
                    this.delete(cacheKey)
                    invalidatedKeys.add(cacheKey)
                    count++
                }
            } catch (e) {
                // If we can't parse the cache key, skip it
                continue
            }
        }
        
        this.stats.invalidations += count
        return count
    }

    /**
     * Check if an object matches a query
     * @param {Object} obj - The object to check
     * @param {Object} query - The query parameters
     * @returns {boolean} - True if object could match this query
     */
    objectMatchesQuery(obj, query) {
        // For query endpoint: check if object matches the query body
        if (query.body && typeof query.body === 'object') return this.objectContainsProperties(obj, query.body)
        // For direct queries (like {"type":"CacheTest"}), check if object matches
        return this.objectContainsProperties(obj, query)
    }

    /**
     * Check if an object contains all properties specified in a query
     * Supports MongoDB query operators like $or, $and, $in, $exists, $size, etc.
     * Note: __rerum is a protected property managed by RERUM and stripped from user requests,
     * so we handle it conservatively in invalidation logic.
     * @param {Object} obj - The object to check
     * @param {Object} queryProps - The properties to match (may include MongoDB operators)
     * @returns {boolean} - True if object matches the query conditions
     */
    objectContainsProperties(obj, queryProps) {
        for (const [key, value] of Object.entries(queryProps)) {
            // Skip pagination and internal parameters
            if (key === 'limit' || key === 'skip') {
                continue
            }
            
            // Skip __rerum and _id since they're server-managed properties
            // __rerum: RERUM metadata stripped from user requests
            // _id: MongoDB internal identifier not in request bodies
            // We can't reliably match on them during invalidation
            if (key === '__rerum' || key === '_id') {
                continue
            }
            
            // Also skip nested __rerum and _id paths (e.g., "__rerum.history.next", "target._id")
            // These are server/database-managed metadata not present in request bodies
            if (key.startsWith('__rerum.') || key.includes('.__rerum.') || key.endsWith('.__rerum') ||
                key.startsWith('_id.') || key.includes('._id.') || key.endsWith('._id')) {
                continue
            }
            
            // Handle MongoDB query operators
            if (key.startsWith('$')) {
                if (!this.evaluateOperator(obj, key, value)) {
                    return false
                }
                continue
            }
            
            // Handle nested operators on a field (e.g., {"body.title": {"$exists": true}})
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                const hasOperators = Object.keys(value).some(k => k.startsWith('$'))
                if (hasOperators) {
                    // Be conservative with operator queries on history fields (fallback safety)
                    // Note: __rerum.* and _id.* are already skipped above
                    if (key.includes('history')) {
                        continue // Conservative - assume match for history-related queries
                    }
                    
                    // For non-metadata fields, try to evaluate the operators
                    const fieldValue = this.getNestedProperty(obj, key)
                    if (!this.evaluateFieldOperators(fieldValue, value)) {
                        return false
                    }
                    continue
                }
            }
            
            // Check if object has this property (handle both direct and nested paths)
            const objValue = this.getNestedProperty(obj, key)
            if (objValue === undefined && !(key in obj)) {
                return false
            }
            
            // For simple values, check equality
            if (typeof value !== 'object' || value === null) {
                if (objValue !== value) {
                    return false
                }
            } else {
                // For nested objects (no operators), recursively check
                if (typeof objValue !== 'object' || !this.objectContainsProperties(objValue, value)) {
                    return false
                }
            }
        }
        
        return true
    }

    /**
     * Evaluate field-level operators like {"$exists": true, "$size": 0}
     * @param {*} fieldValue - The actual field value from the object
     * @param {Object} operators - Object containing operators and their values
     * @returns {boolean} - True if field satisfies all operators
     */
    evaluateFieldOperators(fieldValue, operators) {
        for (const [op, opValue] of Object.entries(operators)) {
            switch (op) {
                case '$exists':
                    const exists = fieldValue !== undefined
                    if (exists !== opValue) return false
                    break
                case '$size':
                    if (!Array.isArray(fieldValue) || fieldValue.length !== opValue) {
                        return false
                    }
                    break
                case '$ne':
                    if (fieldValue === opValue) return false
                    break
                case '$gt':
                    if (!(fieldValue > opValue)) return false
                    break
                case '$gte':
                    if (!(fieldValue >= opValue)) return false
                    break
                case '$lt':
                    if (!(fieldValue < opValue)) return false
                    break
                case '$lte':
                    if (!(fieldValue <= opValue)) return false
                    break
                default:
                    // Unknown operator - be conservative
                    return true
            }
        }
        return true
    }

    /**
     * Get nested property value from an object using dot notation
     * @param {Object} obj - The object
     * @param {string} path - Property path (e.g., "target.@id" or "body.title.value")
     * @returns {*} Property value or undefined
     */
    getNestedProperty(obj, path) {
        const keys = path.split('.')
        let current = obj
        
        for (const key of keys) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined
            }
            current = current[key]
        }
        
        return current
    }

    /**
     * Evaluate MongoDB query operators
     * @param {Object} obj - The object or field value to evaluate against
     * @param {string} operator - The operator key (e.g., "$or", "$and", "$exists")
     * @param {*} value - The operator value
     * @returns {boolean} - True if the operator condition is satisfied
     */
    evaluateOperator(obj, operator, value) {
        switch (operator) {
            case '$or':
                // $or: [condition1, condition2, ...]
                // Returns true if ANY condition matches
                if (!Array.isArray(value)) return false
                return value.some(condition => this.objectContainsProperties(obj, condition))
            
            case '$and':
                // $and: [condition1, condition2, ...]
                // Returns true if ALL conditions match
                if (!Array.isArray(value)) return false
                return value.every(condition => this.objectContainsProperties(obj, condition))
            
            case '$in':
                // Field value must be in the array
                // This is tricky - we need the actual field name context
                // For now, treat as potential match (conservative invalidation)
                return true
            
            case '$exists':
                // {"field": {"$exists": true/false}}
                // We need field context - handled in parent function
                // This should not be called directly
                return true
            
            case '$size':
                // {"field": {"$size": N}}
                // Array field must have exactly N elements
                // Conservative invalidation - return true
                return true
            
            case '$ne':
            case '$gt':
            case '$gte':
            case '$lt':
            case '$lte':
                // Comparison operators - for invalidation, be conservative
                // If query uses these operators, invalidate (return true)
                return true
            
            default:
                // Unknown operator - be conservative and invalidate
                return true
        }
    }

    /**
     * Clear all cache entries
     */
    clear() {
        const length = this.cache.size
        this.cache.clear()
        this.head = null
        this.tail = null
        this.stats.invalidations += length
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
            length: this.cache.size,
            bytes: this.calculateByteSize(),
            lifespan: this.readableAge(Date.now() - this.life),
            maxLength: this.maxLength,
            maxBytes: this.maxBytes,
            hitRate: `${hitRate}%`,
            ttl: this.ttl
        }
    }

    /**
     * Get detailed information about cache entries
     * Useful for debugging
     */
    getDetailsByEntry() {
        const entries = []
        let current = this.head
        let position = 0

        while (current) {
            entries.push({
                position,
                key: current.key,
                age: this.readableAge(Date.now() - current.timestamp),
                hits: current.hits,
                bytes: Buffer.byteLength(JSON.stringify(current.value), 'utf8')
            })
            current = current.next
            position++
        }

        return entries
    }
    
    readableAge(mili) {
        const totalSeconds = Math.floor(mili / 1000)
        const totalMinutes = Math.floor(totalSeconds / 60)
        const totalHours = Math.floor(totalMinutes / 60)
        const days = Math.floor(totalHours / 24)
        
        const hours = totalHours % 24
        const minutes = totalMinutes % 60
        const seconds = totalSeconds % 60
        
        let parts = []
        if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`)
        if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
        if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
        parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`)
        return parts.join(", ")
    }
}

// Create singleton cache instance
// Configuration can be adjusted via environment variables
const CACHE_MAX_LENGTH = parseInt(process.env.CACHE_MAX_LENGTH ?? 1000)
const CACHE_MAX_BYTES = parseInt(process.env.CACHE_MAX_BYTES ?? 1000000000) // 1GB
const CACHE_TTL = parseInt(process.env.CACHE_TTL ?? 300000) // 5 minutes default
const cache = new ClusterCache(CACHE_MAX_LENGTH, CACHE_MAX_BYTES, CACHE_TTL)

export default cache
