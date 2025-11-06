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
    constructor(maxLength = 1000, maxBytes = 1000000000, ttl = 86400000) {
        this.maxLength = maxLength
        this.maxBytes = maxBytes
        this.life = Date.now()
        this.ttl = ttl

        // Detect if running under PM2 (exclude pm2-cluster-cache's -1 value for non-PM2 environments)
        this.isPM2 = typeof process.env.pm_id !== 'undefined' && process.env.pm_id !== '-1'

        this.clusterCache = pm2ClusterCache.init({
            storage: 'all',
            defaultTtl: ttl,
            logger: console
        })
        
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0
        }
        
        this.allKeys = new Set()
        this.keyAccessTimes = new Map() // Track access time for LRU eviction
        this.keySizes = new Map() // Track size of each cached value in bytes
        this.totalBytes = 0 // Track total cache size in bytes
        this.localCache = new Map()
        this.keyExpirations = new Map() // Track TTL expiration times for local cache
        this.clearGeneration = 0 // Track clear operations to coordinate across workers

        // Background stats sync every 5 seconds (only if PM2)
        if (this.isPM2) {
            this.statsInterval = setInterval(() => {
                this._checkClearSignal().catch(() => {})
                this._syncStats().catch(() => {})
            }, 5000)
        }
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
            // Check local cache expiration first (faster than cluster lookup)
            const expirationTime = this.keyExpirations.get(key)
            if (expirationTime !== undefined && Date.now() > expirationTime) {
                // Expired - delete from all caches
                await this.delete(key)
                this.stats.misses++
                return null
            }

            // Only use cluster cache in PM2 mode to avoid IPC timeouts
            if (this.isPM2) {
                const wrappedValue = await this.clusterCache.get(key, undefined)
                if (wrappedValue !== undefined) {
                    this.stats.hits++
                    this.keyAccessTimes.set(key, Date.now()) // Update access time for LRU
                    // Unwrap the value if it's wrapped with metadata
                    return wrappedValue.data !== undefined ? wrappedValue.data : wrappedValue
                }
            }

            // Check local cache (single lookup instead of has + get)
            const localValue = this.localCache.get(key)
            if (localValue !== undefined) {
                this.stats.hits++
                this.keyAccessTimes.set(key, Date.now()) // Update access time for LRU
                return localValue
            }
            this.stats.misses++
            return null
        } catch (err) {
            // Check expiration even in error path
            const expirationTime = this.keyExpirations.get(key)
            if (expirationTime !== undefined && Date.now() > expirationTime) {
                // Expired - delete from all caches
                this.localCache.delete(key)
                this.allKeys.delete(key)
                this.keyAccessTimes.delete(key)
                this.keyExpirations.delete(key)
                const size = this.keySizes.get(key) || 0
                this.keySizes.delete(key)
                this.totalBytes -= size
                this.stats.misses++
                return null
            }

            // Fallback to local cache on error (single lookup)
            const localValue = this.localCache.get(key)
            if (localValue !== undefined) {
                this.stats.hits++
                this.keyAccessTimes.set(key, Date.now()) // Update access time for LRU
                return localValue
            }
            this.stats.misses++
            return null
        }
    }

    /**
     * Calculate approximate size of a value in bytes
     * Fast estimation - avoids JSON.stringify for simple types
     * @param {*} value - Value to measure
     * @returns {number} Approximate size in bytes
     * @private
     */
    _calculateSize(value) {
        if (value === null || value === undefined) return 0
        
        // Fast path for primitives
        const type = typeof value
        if (type === 'string') return value.length * 2
        if (type === 'number') return 8
        if (type === 'boolean') return 4
        
        // For arrays with simple values, estimate quickly
        if (Array.isArray(value)) {
            if (value.length === 0) return 8
            // If small array, just estimate
            if (value.length < 10) {
                return value.reduce((sum, item) => sum + this._calculateSize(item), 16)
            }
        }
        
        // For objects/complex types, fall back to JSON stringify
        // This is still expensive but only for complex objects
        const str = JSON.stringify(value)
        return str.length * 2
    }

    /**
     * Set value in cache
     * @param {string} key - Cache key
     * @param {*} value - Value to cache
     * @param {number} ttl - Optional time-to-live in milliseconds (defaults to constructor ttl)
     */
    async set(key, value, ttl) {
        try {
            const now = Date.now()
            const isUpdate = this.allKeys.has(key)
            const keyType = key.split(':')[0]
            // Use provided TTL or fall back to default
            const effectiveTTL = ttl !== undefined ? ttl : this.ttl

            // Calculate size only once (can be expensive for large objects)
            const valueSize = this._calculateSize(value)

            // If updating existing key, subtract old size first
            if (isUpdate) {
                const oldSize = this.keySizes.get(key) || 0
                this.totalBytes -= oldSize
            }

            // Wrap value with metadata to prevent PM2 cluster-cache deduplication
            const wrappedValue = {
                data: value,
                key: key,
                cachedAt: now,
                size: valueSize
            }

            // Set in cluster cache only in PM2 mode to avoid IPC timeouts
            if (this.isPM2) {
                await this.clusterCache.set(key, wrappedValue, effectiveTTL)
            }

            // Update local state (reuse precalculated values)
            this.stats.sets++
            this.allKeys.add(key)
            this.keyAccessTimes.set(key, now)
            this.keySizes.set(key, valueSize)
            this.totalBytes += valueSize
            this.localCache.set(key, value)

            // Track expiration time for local cache TTL enforcement
            if (effectiveTTL > 0) {
                this.keyExpirations.set(key, now + effectiveTTL)
            }

            // Check limits and evict if needed (do this after set to avoid blocking)
            // Use setImmediate to defer eviction checks without blocking
            setImmediate(async () => {
                try {
                    const clusterKeyCount = await this._getClusterKeyCount()
                    if (clusterKeyCount > this.maxLength) {
                        await this._evictLRU()
                    }
                    
                    let clusterTotalBytes = await this._getClusterTotalBytes()
                    let evictionCount = 0
                    const maxEvictions = 100
                    
                    while (clusterTotalBytes > this.maxBytes && 
                           this.allKeys.size > 0 && 
                           evictionCount < maxEvictions) {
                        await this._evictLRU()
                        evictionCount++
                        clusterTotalBytes = await this._getClusterTotalBytes()
                    }
                } catch (err) {
                    console.error('Background eviction error:', err)
                }
            })
        } catch (err) {
            console.error('Cache set error:', err)
            // Fallback: still update local cache
            const valueSize = this._calculateSize(value)
            this.localCache.set(key, value)
            this.allKeys.add(key)
            this.keyAccessTimes.set(key, Date.now())
            this.keySizes.set(key, valueSize)
            this.stats.sets++
        }
    }

    /**
     * Delete specific key from cache
     * @param {string} key - Cache key to delete
     */
    async delete(key) {
        try {
            // Only delete from cluster cache in PM2 mode to avoid IPC timeouts
            if (this.isPM2) {
                await this.clusterCache.delete(key)
            }
            this.allKeys.delete(key)
            this.keyAccessTimes.delete(key) // Clean up access time tracking
            this.keyExpirations.delete(key) // Clean up expiration tracking
            const size = this.keySizes.get(key) || 0
            this.keySizes.delete(key)
            this.totalBytes -= size
            this.localCache.delete(key)
            return true
        } catch (err) {
            this.localCache.delete(key)
            this.allKeys.delete(key)
            this.keyAccessTimes.delete(key) // Clean up access time tracking
            this.keyExpirations.delete(key) // Clean up expiration tracking
            const size = this.keySizes.get(key) || 0
            this.keySizes.delete(key)
            this.totalBytes -= size
            return false
        }
    }

    /**
     * Clear all cache entries and reset stats across all workers
     */
    async clear() {
        try {
            if (this.statsInterval) {
                clearInterval(this.statsInterval)
            }

            // Only do PM2 cluster operations if running under PM2
            if (this.isPM2) {
                // Increment clear generation to signal all workers
                this.clearGeneration++
                const clearGen = this.clearGeneration

                // Flush all cache data FIRST
                await this.clusterCache.flush()

                // THEN set the clear signal AFTER flush so it doesn't get deleted
                // This allows other workers to see the signal and clear their local state
                await this.clusterCache.set('_clear_signal', {
                    generation: clearGen,
                    timestamp: Date.now()
                }, 60000) // 1 minute TTL

                // Delete all old worker stats keys immediately
                try {
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
                } catch (err) {
                    console.error('Error deleting worker stats:', err)
                }
            }

            // Reset local state
            this.allKeys.clear()
            this.keyAccessTimes.clear()
            this.keySizes.clear()
            this.keyExpirations.clear()
            this.totalBytes = 0
            this.localCache.clear()

            this.stats = {
                hits: 0,
                misses: 0,
                evictions: 0,
                sets: 0,
                invalidations: 0
            }

            // Restart stats sync interval (only if PM2)
            if (this.isPM2) {
                this.statsInterval = setInterval(() => {
                    this._checkClearSignal().catch(() => {})
                    this._syncStats().catch(() => {})
                }, 5000)

                // Immediately sync our fresh stats
                await this._syncStats()
            }
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
        // In non-PM2 mode, use local count directly to avoid IPC timeouts
        if (!this.isPM2) {
            return this.allKeys.size
        }

        try {
            const keysMap = await this.clusterCache.keys()
            const uniqueKeys = new Set()

            for (const instanceKeys of Object.values(keysMap)) {
                if (Array.isArray(instanceKeys)) {
                    instanceKeys.forEach(key => {
                        // Exclude internal keys from count
                        if (!key.startsWith('_stats_worker_') && key !== '_clear_signal') {
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
     * @param {Set} invalidatedKeys - Set of already invalidated keys to skip
     * @returns {Promise<number>} Number of keys invalidated
     */
    async invalidate(pattern, invalidatedKeys = new Set()) {
        let count = 0

        try {
            let allKeys = new Set()

            // In PM2 mode, get keys from cluster cache; otherwise use local keys
            if (this.isPM2) {
                const keysMap = await this.clusterCache.keys()
                for (const instanceKeys of Object.values(keysMap)) {
                    if (Array.isArray(instanceKeys)) {
                        instanceKeys.forEach(key => allKeys.add(key))
                    }
                }
            } else {
                // In non-PM2 mode, use local keys to avoid IPC timeouts
                allKeys = new Set(this.allKeys)
            }

            const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern)

            const deletePromises = []
            const matchedKeys = []
            for (const key of allKeys) {
                if (invalidatedKeys.has(key)) {
                    continue
                }

                if (regex.test(key)) {
                    deletePromises.push(this.delete(key))
                    matchedKeys.push(key)
                    invalidatedKeys.add(key)
                    count++
                }
            }

            await Promise.all(deletePromises)
        } catch (err) {
            console.error('Cache invalidate error:', err)
        }

        return count
    }

    /**
     * Wait for the next sync cycle to complete across all workers.
     * Syncs current worker immediately, then waits for background sync interval.
     */
    async waitForSync() {
        // Sync our own stats immediately
        await this._syncStats()
        // Give the rest of the workers time to sync, it usually takes around 5 seconds to be certain.
        await new Promise(resolve => setTimeout(resolve, 6000))
    }

    /**
     * Get cache statistics aggregated across all PM2 workers
     */
    async getStats() {
        try {
            // Wait for all workers to sync
            await this.waitForSync()

            const aggregatedStats = await this._aggregateStats()

            let cacheLength = this.allKeys.size

            // In PM2 mode, get actual cluster key count; otherwise use local count
            if (this.isPM2) {
                const keysMap = await this.clusterCache.keys()
                const uniqueKeys = new Set()

                for (const instanceKeys of Object.values(keysMap)) {
                    if (Array.isArray(instanceKeys)) {
                        instanceKeys.forEach(key => {
                            // Exclude internal keys from cache length
                            if (!key.startsWith('_stats_worker_') && key !== '_clear_signal') {
                                uniqueKeys.add(key)
                            }
                        })
                    }
                }
                cacheLength = uniqueKeys.size
            }

            const uptime = Date.now() - this.life
            const hitRate = aggregatedStats.hits + aggregatedStats.misses > 0
                ? (aggregatedStats.hits / (aggregatedStats.hits + aggregatedStats.misses) * 100).toFixed(2)
                : '0.00'

            return {
                length: cacheLength,
                maxLength: this.maxLength,
                totalBytes: aggregatedStats.totalBytes,
                maxBytes: this.maxBytes,
                ttl: this.ttl,
                hits: aggregatedStats.hits,
                misses: aggregatedStats.misses,
                sets: aggregatedStats.sets,
                evictions: aggregatedStats.evictions,
                hitRate: `${hitRate}%`,
                uptime: this._formatUptime(uptime),
                mode: 'cluster-interval-sync'
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
            let allKeys = new Set()

            // In PM2 mode, get keys from cluster cache; otherwise use local keys
            if (this.isPM2) {
                const keysMap = await this.clusterCache.keys()
                for (const instanceKeys of Object.values(keysMap)) {
                    if (Array.isArray(instanceKeys)) {
                        instanceKeys.forEach(key => {
                            if (!key.startsWith('_stats_worker_') && !key.startsWith('_clear_signal')) {
                                allKeys.add(key)
                            }
                        })
                    }
                }
            } else {
                // In non-PM2 mode, use local keys to avoid IPC timeouts
                allKeys = new Set(this.allKeys)
            }

            const details = []
            let position = 0
            for (const key of allKeys) {
                let wrappedValue

                // In PM2 mode, get from cluster cache; otherwise get from local cache
                if (this.isPM2) {
                    wrappedValue = await this.clusterCache.get(key, undefined)
                } else {
                    wrappedValue = this.localCache.get(key)
                }

                // Handle both wrapped and unwrapped values
                const actualValue = wrappedValue?.data !== undefined ? wrappedValue.data : wrappedValue
                const size = wrappedValue?.size || this._calculateSize(actualValue)
                const cachedAt = wrappedValue?.cachedAt || Date.now()
                const age = Date.now() - cachedAt

                details.push({
                    position,
                    key,
                    age: this._formatUptime(age),
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
        // Only check for clear signal in PM2 cluster mode to avoid IPC timeouts
        if (!this.isPM2) {
            return
        }

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
        // Only sync stats in PM2 cluster mode to avoid IPC timeouts
        if (!this.isPM2) {
            return
        }

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
        // In non-PM2 mode, return local stats directly to avoid IPC timeouts
        if (!this.isPM2) {
            return { ...this.stats, totalBytes: this.totalBytes }
        }

        try {
            const keysMap = await this.clusterCache.keys()
            const aggregated = {
                hits: 0,
                misses: 0,
                sets: 0,
                evictions: 0,
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
        if (!obj || typeof obj !== 'object') {
            return 0
        }

        let count = 0

        // Get all query/search keys from ALL workers in the cluster by scanning cluster cache directly
        let keysToCheck = []
        if (this.isPM2) {
            try {
                // Scan all keys directly from cluster cache (all workers)
                const keysMap = await this.clusterCache.keys()
                const uniqueKeys = new Set()

                // Aggregate keys from all PM2 instances
                for (const instanceKeys of Object.values(keysMap)) {
                    if (Array.isArray(instanceKeys)) {
                        instanceKeys.forEach(key => {
                            if (key.startsWith('query:') || key.startsWith('search:') || key.startsWith('searchPhrase:')) {
                                uniqueKeys.add(key)
                            }
                        })
                    }
                }

                keysToCheck = Array.from(uniqueKeys)
            } catch (err) {
                keysToCheck = Array.from(this.allKeys).filter(k =>
                    k.startsWith('query:') || k.startsWith('search:') || k.startsWith('searchPhrase:')
                )
            }
        } else {
            keysToCheck = Array.from(this.allKeys).filter(k =>
                k.startsWith('query:') || k.startsWith('search:') || k.startsWith('searchPhrase:')
            )
        }

        if (keysToCheck.length > 0) {
            const keyTypes = {}
            keysToCheck.forEach(k => {
                const type = k.split(':')[0]
                keyTypes[type] = (keyTypes[type] || 0) + 1
            })
        }

        const hasQueryKeys = keysToCheck.some(k =>
            k.startsWith('query:') || k.startsWith('search:') || k.startsWith('searchPhrase:')
        )
        if (!hasQueryKeys) {
            return 0
        }

        const queryKeys = keysToCheck.filter(k =>
            k.startsWith('query:') || k.startsWith('search:') || k.startsWith('searchPhrase:')
        )

        for (const cacheKey of keysToCheck) {
            if (!cacheKey.startsWith('query:') &&
                !cacheKey.startsWith('search:') &&
                !cacheKey.startsWith('searchPhrase:')) {
                continue
            }

            // Skip if already invalidated
            if (invalidatedKeys.has(cacheKey)) {
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
                // Silently skip cache keys that can't be parsed or matched
                continue
            }
        }

        return count
    }

    /**
     * Check if an object matches a query
     * @param {Object} obj - The object to check
     * @param {Object} query - The query parameters
     * @returns {boolean} True if object could match this query
     */
    objectMatchesQuery(obj, query) {
        // Handle search/searchPhrase caches
        if (query.searchText !== undefined) {
            return this.objectMatchesSearchText(obj, query.searchText)
        }

        // Handle query caches
        return query.__cached && typeof query.__cached === 'object'
            ? this.objectContainsProperties(obj, query.__cached)
            : this.objectContainsProperties(obj, query)
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
                case '$in':
                    if (!Array.isArray(opValue)) return false
                    return opValue.includes(fieldValue)
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
            default:
                return true // Unknown operator - be conservative
        }
    }

    /**
     * Get nested property value using dot notation
     * @param {Object} obj - The object
     * @param {string} path - Property path (e.g., "user.profile.name")
     * @returns {*} Property value or undefined
     */
    getNestedProperty(obj, path) {
        if (!path.includes('.')) {
            return obj?.[path]
        }

        const keys = path.split('.')
        let current = obj

        for (let i = 0; i < keys.length; i++) {
            const key = keys[i]

            if (current === null || current === undefined) {
                return undefined
            }

            // If current is an array, check if any element has the remaining path
            if (Array.isArray(current)) {
                const remainingPath = keys.slice(i).join('.')
                // Return the first matching value from array elements
                for (const item of current) {
                    const value = this.getNestedProperty(item, remainingPath)
                    if (value !== undefined) {
                        return value
                    }
                }
                return undefined
            }

            if (typeof current !== 'object') {
                return undefined
            }

            current = current[key]
        }

        return current
    }

    /**
     * Check if an Annotation object contains the search text
     * Used for invalidating search/searchPhrase caches
     * Normalizes diacritics to match MongoDB Atlas Search behavior
     * @param {Object} obj - The object to check
     * @param {string} searchText - The search text from the cache key
     * @returns {boolean} True if object matches search text
     */
    objectMatchesSearchText(obj, searchText) {
        // Only Annotations are searchable
        if (obj.type !== 'Annotation' && obj['@type'] !== 'Annotation') {
            return false
        }

        if (!searchText || typeof searchText !== 'string') {
            return false
        }

        // Normalize text: strip diacritics and lowercase to match MongoDB Atlas Search
        const normalizeText = (text) => {
            return text.normalize('NFD')           // Decompose combined characters
                       .replace(/[\u0300-\u036f]/g, '')  // Remove combining diacritical marks
                       .toLowerCase()
        }

        const searchWords = normalizeText(searchText).split(/\s+/)
        const annotationText = normalizeText(this.extractAnnotationText(obj))

        // Conservative: invalidate if ANY search word appears in annotation text
        return searchWords.some(word => annotationText.includes(word))
    }

    /**
     * Recursively extract all searchable text from an Annotation
     * Extracts from IIIF 3.0 and 2.1 Annotation body fields
     * @param {Object} obj - The object to extract text from
     * @param {Set} visited - Set of visited objects to prevent circular references
     * @returns {string} Concatenated text from all searchable fields
     */
    extractAnnotationText(obj, visited = new Set()) {
        // Prevent circular references
        if (!obj || typeof obj !== 'object' || visited.has(obj)) {
            return ''
        }
        visited.add(obj)

        let text = ''

        // IIIF 3.0 Annotation fields
        if (obj.body?.value) text += ' ' + obj.body.value
        if (obj.bodyValue) text += ' ' + obj.bodyValue

        // IIIF 2.1 Annotation fields
        if (obj.resource?.chars) text += ' ' + obj.resource.chars
        if (obj.resource?.['cnt:chars']) text += ' ' + obj.resource['cnt:chars']

        // Recursively check nested arrays (items, annotations)
        if (Array.isArray(obj.items)) {
            obj.items.forEach(item => {
                text += ' ' + this.extractAnnotationText(item, visited)
            })
        }

        if (Array.isArray(obj.annotations)) {
            obj.annotations.forEach(anno => {
                text += ' ' + this.extractAnnotationText(anno, visited)
            })
        }

        return text
    }
}

const CACHE_MAX_LENGTH = parseInt(process.env.CACHE_MAX_LENGTH ?? 1000)
const CACHE_MAX_BYTES = parseInt(process.env.CACHE_MAX_BYTES ?? 1000000000)
const CACHE_TTL = parseInt(process.env.CACHE_TTL ?? 86400000)
const cache = new ClusterCache(CACHE_MAX_LENGTH, CACHE_MAX_BYTES, CACHE_TTL)

export default cache
