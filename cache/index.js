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
        this.localCache = new Map()
        
        // Background stats sync every 5 seconds
        this.statsInterval = setInterval(() => {
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
                return value
            }
            if (this.localCache.has(key)) {
                this.stats.hits++
                return this.localCache.get(key)
            }
            this.stats.misses++
            return null
        } catch (err) {
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
            this.localCache.set(key, value)
        } catch (err) {
            console.error('Cache set error:', err)
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
     * Clear all cache entries and reset stats
     */
    async clear() {
        try {
            clearInterval(this.statsInterval)
            
            await this.clusterCache.flush()
            this.allKeys.clear()
            this.localCache.clear()
            
            this.stats = {
                hits: 0,
                misses: 0,
                evictions: 1,
                sets: 0,
                invalidations: 0
            }
            
            await new Promise(resolve => setTimeout(resolve, 100))
            
            this.statsInterval = setInterval(() => {
                this._syncStats().catch(() => {})
            }, 5000)
        } catch (err) {
            console.error('Cache clear error:', err)
            this.localCache.clear()
            this.allKeys.clear()
            this.stats.evictions++
            
            if (!this.statsInterval._destroyed) {
                clearInterval(this.statsInterval)
            }
            this.statsInterval = setInterval(() => {
                this._syncStats().catch(() => {})
            }, 5000)
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
     * Sync current worker stats to cluster cache (called by background interval)
     * @private
     */
    async _syncStats() {
        try {
            const workerId = process.env.pm_id || process.pid
            const statsKey = `_stats_worker_${workerId}`
            await this.clusterCache.set(statsKey, {
                ...this.stats,
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
                invalidations: 0
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
            return { ...this.stats }
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
