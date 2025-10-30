#!/usr/bin/env node

/**
 * PM2 Cluster-synchronized cache implementation for RERUM API
 * 
 * Uses pm2-cluster-cache with 'all' storage mode to replicate cache across all PM2 workers.
 * Provides smart invalidation on writes to maintain consistency.
 * Falls back to local-only Map if not running under PM2.
 * 
 * @author thehabes
 */

import pm2ClusterCache from 'pm2-cluster-cache'

/**
 * Cluster-synchronized cache with PM2 replication
 */
class ClusterCache {
    constructor(maxLength = 1000, maxBytes = 1000000000, ttl = 300000) {
        this.maxLength = maxLength
        this.maxBytes = maxBytes
        this.life = Date.now()
        this.ttl = ttl
        
        this.clusterCache = pm2ClusterCache.init({
            storage: 'all',
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
        
        this.allKeys = new Set()
        this.keyAccessTimes = new Map() // Track access time for LRU eviction
        this.keySizes = new Map() // Track size of each cached value in bytes
        this.totalBytes = 0 // Track total cache size in bytes
        this.localCache = new Map()
        this.clearGeneration = 0 // Track clear operations to coordinate across workers
        
        // Background stats sync every 5 seconds
        this.statsInterval = setInterval(() => {
            this._checkClearSignal().catch(() => {})
            this._syncStats().catch(() => {})
        }, 5000)
    }

    /**
     * Generate cache key from request parameters
     * @param {string} type - Cache type (query, search, searchPhrase, id, history, since)
     * @param {Object|string} params - Request parameters or ID string
     * @returns {string} Cache key
     */
    generateKey(type, params) {
        if (type === 'id' || type === 'history' || type === 'since') return `${type}:${params}` 
        
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
     * @returns {Promise<*>} Cached value or null
     */
    async get(key) {
        try {
            const value = await this.clusterCache.get(key, undefined)
            if (value !== undefined) {
                this.stats.hits++
                this.keyAccessTimes.set(key, Date.now()) // Update access time for LRU
                return value
            }
            if (this.localCache.has(key)) {
                this.stats.hits++
                this.keyAccessTimes.set(key, Date.now()) // Update access time for LRU
                return this.localCache.get(key)
            }
            this.stats.misses++
            return null
        } catch (err) {
            if (this.localCache.has(key)) {
                this.stats.hits++
                this.keyAccessTimes.set(key, Date.now()) // Update access time for LRU
                return this.localCache.get(key)
            }
            this.stats.misses++
            return null
        }
    }

    /**
     * Calculate approximate size of a value in bytes
     * @param {*} value - Value to measure
     * @returns {number} Approximate size in bytes
     * @private
     */
    _calculateSize(value) {
        if (value === null || value === undefined) return 0
        const str = JSON.stringify(value)
        // Each character is approximately 2 bytes in UTF-16
        return str.length * 2
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     */
    async set(key, value) {
        try {
            const valueSize = this._calculateSize(value)
            const isUpdate = this.allKeys.has(key)
            
            // If updating existing key, subtract old size first
            if (isUpdate) {
                const oldSize = this.keySizes.get(key) || 0
                this.totalBytes -= oldSize
            }
            
            // Get cluster-wide metrics for accurate limit enforcement
            const clusterKeyCount = await this._getClusterKeyCount()
            
            // Check if we need to evict due to maxLength (cluster-wide)
            if (clusterKeyCount >= this.maxLength && !isUpdate) {
                await this._evictLRU()
            }
            
            // Check if we need to evict due to maxBytes (cluster-wide)
            let clusterTotalBytes = await this._getClusterTotalBytes()
            let evictionCount = 0
            const maxEvictions = 100 // Prevent infinite loops
            
            while (clusterTotalBytes + valueSize > this.maxBytes && 
                   this.allKeys.size > 0 && 
                   evictionCount < maxEvictions) {
                await this._evictLRU()
                evictionCount++
                // Recalculate cluster total bytes after eviction
                clusterTotalBytes = await this._getClusterTotalBytes()
            }
            
            await this.clusterCache.set(key, value, this.ttl)
            this.stats.sets++
            this.allKeys.add(key)
            this.keyAccessTimes.set(key, Date.now()) // Track access time
            this.keySizes.set(key, valueSize) // Track size
            this.totalBytes += valueSize
            this.localCache.set(key, value)
        } catch (err) {
            console.error('Cache set error:', err)
            // Fallback: still enforce eviction on local cache
            const valueSize = this._calculateSize(value)
            const isUpdate = this.allKeys.has(key)
            
            if (isUpdate) {
                const oldSize = this.keySizes.get(key) || 0
                this.totalBytes -= oldSize
            }
            
            if (this.allKeys.size >= this.maxLength && !isUpdate) {
                await this._evictLRU()
            }
            
            while (this.totalBytes + valueSize > this.maxBytes && this.allKeys.size > 0) {
                await this._evictLRU()
            }
            
            this.localCache.set(key, value)
            this.allKeys.add(key)
            this.keyAccessTimes.set(key, Date.now())
            this.keySizes.set(key, valueSize)
            this.totalBytes += valueSize
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
            this.keyAccessTimes.delete(key) // Clean up access time tracking
            const size = this.keySizes.get(key) || 0
            this.keySizes.delete(key)
            this.totalBytes -= size
            this.localCache.delete(key)
            return true
        } catch (err) {
            this.localCache.delete(key)
            this.allKeys.delete(key)
            this.keyAccessTimes.delete(key) // Clean up access time tracking
            const size = this.keySizes.get(key) || 0
            this.keySizes.delete(key)
            this.totalBytes -= size
            return false
        }
    }

    /**
     * Clear all cache entries and reset stats
     */
    /**
     * Clear all cache entries and reset stats across all workers
     */
    async clear() {
        try {
            clearInterval(this.statsInterval)
            
            // Increment clear generation to signal all workers
            this.clearGeneration++
            
            // Broadcast clear signal to all workers via cluster cache
            await this.clusterCache.set('_clear_signal', {
                generation: this.clearGeneration,
                timestamp: Date.now()
            }, 60000) // 1 minute TTL
            
            // Flush all cache data
            await this.clusterCache.flush()
            
            // Reset local state
            this.allKeys.clear()
            this.keyAccessTimes.clear()
            this.keySizes.clear()
            this.totalBytes = 0
            this.localCache.clear()
            
            this.stats = {
                hits: 0,
                misses: 0,
                evictions: 0,
                sets: 0,
                invalidations: 0
            }
            
            // Restart stats sync interval
            this.statsInterval = setInterval(() => {
                this._checkClearSignal().catch(() => {})
                this._syncStats().catch(() => {})
            }, 5000)
            
            // Immediately sync our fresh stats
            await this._syncStats()
            
            // Wait for all workers to see the clear signal and reset
            // Workers check every 5 seconds, so wait 6 seconds to be safe
            await new Promise(resolve => setTimeout(resolve, 6000))
            
            // Delete all old worker stats keys
            const keysMap = await this.clusterCache.keys()
            const deletePromises = []
            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    for (const key of instanceKeys) {
                        if (key.startsWith('_stats_worker_')) {
                            deletePromises.push(this.clusterCache.delete(key))
                        }
                    }
                }
            }
            await Promise.all(deletePromises)
            
            // Final sync after cleanup
            await this._syncStats()
        } catch (err) {
            console.error('Cache clear error:', err)
            this.localCache.clear()
            this.allKeys.clear()
            this.keyAccessTimes.clear()
            this.keySizes.clear()
            this.totalBytes = 0
            this.stats = {
                hits: 0,
                misses: 0,
                evictions: 0,
                sets: 0,
                invalidations: 0
            }
            
            if (!this.statsInterval._destroyed) {
                clearInterval(this.statsInterval)
            }
            this.statsInterval = setInterval(() => {
                this._checkClearSignal().catch(() => {})
                this._syncStats().catch(() => {})
            }, 5000)
        }
    }

    /**
     * Get cluster-wide unique key count
     * @returns {Promise<number>} Total number of unique keys across all workers
     * @private
     */
    async _getClusterKeyCount() {
        try {
            const keysMap = await this.clusterCache.keys()
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
            // Fallback to local count on error
            return this.allKeys.size
        }
    }

    /**
     * Get cluster-wide total bytes
     * Since PM2 cache uses storage:'all', all workers have same data.
     * Use local totalBytes which should match across all workers.
     * @returns {Promise<number>} Total bytes in cache
     * @private
     */
    async _getClusterTotalBytes() {
        return this.totalBytes
    }

    /**
     * Evict least recently used (LRU) entry from cache
     * Called when cache reaches maxLength limit
     * @private
     */
    async _evictLRU() {
        if (this.allKeys.size === 0) return
        
        // Find the key with the oldest access time
        let oldestKey = null
        let oldestTime = Infinity
        
        for (const key of this.allKeys) {
            const accessTime = this.keyAccessTimes.get(key) || 0
            if (accessTime < oldestTime) {
                oldestTime = accessTime
                oldestKey = key
            }
        }
        
        if (oldestKey) {
            await this.delete(oldestKey)
            this.stats.evictions++
        }
    }

    /**
     * Invalidate cache entries matching a pattern
     * @param {string|RegExp} pattern - Pattern to match keys against
     * @returns {Promise<number>} Number of keys invalidated
     */
    async invalidate(pattern) {
        let count = 0
        
        try {
            const keysMap = await this.clusterCache.keys()
            const allKeys = new Set()
            
            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    instanceKeys.forEach(key => allKeys.add(key))
                }
            }
            
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
     * Get cache statistics aggregated across all PM2 workers
     * 
     * Stats synced every 5s by background interval (may be up to 5s stale).
     * Response time <10ms vs 200+ms for real-time sync via PM2 messaging.
     * 
     * @returns {Promise<Object>} Statistics object
     */
    async getStats() {
        try {
            const aggregatedStats = await this._aggregateStats()
            
            const keysMap = await this.clusterCache.keys()
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
            
            const uptime = Date.now() - this.life
            const hitRate = aggregatedStats.hits + aggregatedStats.misses > 0
                ? (aggregatedStats.hits / (aggregatedStats.hits + aggregatedStats.misses) * 100).toFixed(2)
                : '0.00'
            
            return {
                length: uniqueKeys.size,
                maxLength: this.maxLength,
                totalBytes: aggregatedStats.totalBytes,
                maxBytes: this.maxBytes,
                ttl: this.ttl,
                hits: aggregatedStats.hits,
                misses: aggregatedStats.misses,
                sets: aggregatedStats.sets,
                evictions: aggregatedStats.evictions,
                invalidations: aggregatedStats.invalidations,
                hitRate: `${hitRate}%`,
                uptime: this._formatUptime(uptime),
                mode: 'cluster-interval-sync',
                synchronized: true
            }
        } catch (err) {
            console.error('Cache getStats error:', err)
            const uptime = Date.now() - this.life
            const hitRate = this.stats.hits + this.stats.misses > 0
                ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
                : '0.00'
            return {
                ...this.stats,
                length: this.allKeys.size,
                maxLength: this.maxLength,
                totalBytes: this.totalBytes,
                maxBytes: this.maxBytes,
                ttl: this.ttl,
                hitRate: `${hitRate}%`,
                uptime: this._formatUptime(uptime),
                mode: 'cluster-interval-sync',
                synchronized: true,
                error: err.message
            }
        }
    }

    /**
     * Get detailed list of all cache entries
     * @returns {Promise<Array>} Array of cache entry details
     */
    async getDetails() {
        try {
            const keysMap = await this.clusterCache.keys()
            const allKeys = new Set()
            
            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    instanceKeys.forEach(key => {
                        if (!key.startsWith('_stats_worker_') && !key.startsWith('_clear_signal')) {
                            allKeys.add(key)
                        }
                    })
                }
            }
            
            const details = []
            let position = 0
            for (const key of allKeys) {
                const value = await this.clusterCache.get(key, undefined)
                const size = this._calculateSize(value)
                
                details.push({
                    position,
                    key,
                    bytes: size
                })
                position++
            }
            
            return details
        } catch (err) {
            console.error('Cache getDetails error:', err)
            return []
        }
    }

    /**
     * Check for clear signal from other workers
     * @private
     */
    async _checkClearSignal() {
        try {
            const signal = await this.clusterCache.get('_clear_signal', undefined)
            if (signal && signal.generation > this.clearGeneration) {
                // Another worker initiated a clear - reset our local state
                this.clearGeneration = signal.generation
                
                this.allKeys.clear()
                this.keyAccessTimes.clear()
                this.keySizes.clear()
                this.totalBytes = 0
                this.localCache.clear()
                
                this.stats = {
                    hits: 0,
                    misses: 0,
                    evictions: 0,
                    sets: 0,
                    invalidations: 0
                }
                
                // Delete our worker stats key immediately
                const workerId = process.env.pm_id || process.pid
                const statsKey = `_stats_worker_${workerId}`
                await this.clusterCache.delete(statsKey)
            }
        } catch (err) {
            // Silently fail
        }
    }

    /**
     * Sync current worker stats to cluster cache (called by background interval)
     * @private
     */
    async _syncStats() {
        try {
            const workerId = process.env.pm_id || process.pid
            const statsKey = `_stats_worker_${workerId}`
            await this.clusterCache.set(statsKey, {
                ...this.stats,
                totalBytes: this.totalBytes,
                workerId,
                timestamp: Date.now()
            }, 10000)
        } catch (err) {
            // Silently fail
        }
    }

    /**
     * Aggregate stats from all workers (reads stats synced by background interval)
     * @private
     * @returns {Promise<Object>} Aggregated stats
     */
    async _aggregateStats() {
        try {
            const keysMap = await this.clusterCache.keys()
            const aggregated = {
                hits: 0,
                misses: 0,
                sets: 0,
                evictions: 0,
                invalidations: 0,
                totalBytes: 0
            }
            const processedWorkers = new Set()
            
            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    for (const key of instanceKeys) {
                        if (key.startsWith('_stats_worker_')) {
                            const workerId = key.replace('_stats_worker_', '')
                            if (processedWorkers.has(workerId)) {
                                continue
                            }
                            
                            try {
                                const workerStats = await this.clusterCache.get(key, undefined)
                                if (workerStats && typeof workerStats === 'object') {
                                    aggregated.hits += workerStats.hits || 0
                                    aggregated.misses += workerStats.misses || 0
                                    aggregated.sets += workerStats.sets || 0
                                    aggregated.evictions += workerStats.evictions || 0
                                    aggregated.invalidations += workerStats.invalidations || 0
                                    aggregated.totalBytes += workerStats.totalBytes || 0
                                    processedWorkers.add(workerId)
                                }
                            } catch (err) {
                                continue
                            }
                        }
                    }
                }
            }
            
            return aggregated
        } catch (err) {
            return { ...this.stats, totalBytes: this.totalBytes }
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
     * Invalidates query/search caches that could potentially match this object
     * @param {Object} obj - The created/updated object
     * @param {Set} invalidatedKeys - Set to track invalidated keys (optional)
     * @returns {Promise<number>} Number of cache entries invalidated
     */
    async invalidateByObject(obj, invalidatedKeys = new Set()) {
        if (!obj || typeof obj !== 'object') return 0
        
        let count = 0
        const keysToCheck = Array.from(this.allKeys)
        
        for (const cacheKey of keysToCheck) {
            if (!cacheKey.startsWith('query:') && 
                !cacheKey.startsWith('search:') && 
                !cacheKey.startsWith('searchPhrase:')) {
                continue
            }
            
            const colonIndex = cacheKey.indexOf(':')
            if (colonIndex === -1) continue
            
            try {
                const queryJson = cacheKey.substring(colonIndex + 1)
                const queryParams = JSON.parse(queryJson)
                
                if (this.objectMatchesQuery(obj, queryParams)) {
                    await this.delete(cacheKey)
                    invalidatedKeys.add(cacheKey)
                    count++
                }
            } catch (e) {
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
     * @returns {boolean} True if object could match this query
     */
    objectMatchesQuery(obj, query) {
        if (query.body && typeof query.body === 'object') return this.objectContainsProperties(obj, query.body)
        return this.objectContainsProperties(obj, query)
    }

    /**
     * Check if an object contains all properties specified in a query
     * Supports MongoDB query operators ($or, $and, $exists, $size, comparisons, etc.)
     * @param {Object} obj - The object to check
     * @param {Object} queryProps - The properties to match
     * @returns {boolean} True if object matches the query conditions
     */
    objectContainsProperties(obj, queryProps) {
        for (const [key, value] of Object.entries(queryProps)) {
            if (key === 'limit' || key === 'skip') continue
            
            // Skip server-managed properties (__rerum, _id)
            if (key === '__rerum' || key === '_id') continue
            if (key.startsWith('__rerum.') || key.includes('.__rerum.') || key.endsWith('.__rerum') ||
                key.startsWith('_id.') || key.includes('._id.') || key.endsWith('._id')) {
                continue
            }
            
            if (key.startsWith('$')) {
                if (!this.evaluateOperator(obj, key, value)) {
                    return false
                }
                continue
            }
            
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                const hasOperators = Object.keys(value).some(k => k.startsWith('$'))
                if (hasOperators) {
                    if (key.includes('history')) continue
                    const fieldValue = this.getNestedProperty(obj, key)
                    if (!this.evaluateFieldOperators(fieldValue, value)) {
                        return false
                    }
                    continue
                }
            }
            
            const objValue = this.getNestedProperty(obj, key)
            if (objValue === undefined && !(key in obj)) {
                return false
            }
            
            if (typeof value !== 'object' || value === null) {
                if (objValue !== value) return false
            } else {
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

// Create singleton cache instance
// Configuration can be adjusted via environment variables
const CACHE_MAX_LENGTH = parseInt(process.env.CACHE_MAX_LENGTH ?? 1000)
const CACHE_MAX_BYTES = parseInt(process.env.CACHE_MAX_BYTES ?? 1000000000) // 1GB
const CACHE_TTL = parseInt(process.env.CACHE_TTL ?? 300000) // 5 minutes default
const cache = new ClusterCache(CACHE_MAX_LENGTH, CACHE_MAX_BYTES, CACHE_TTL)

export default cache
