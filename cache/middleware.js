#!/usr/bin/env node

/**
 * Cache middleware for RERUM API routes
 * Provides caching for read operations and invalidation for write operations
 * @author thehabes
 */

import cache from './index.js'

/**
 * Cache middleware for query endpoint
 * Caches results based on query parameters, limit, and skip
 */
const cacheQuery = (req, res, next) => {
    // Only cache POST requests with body
    if (req.method !== 'POST' || !req.body) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    
    // Create cache key including pagination params
    const cacheParams = {
        body: req.body,
        limit,
        skip
    }
    const cacheKey = cache.generateKey('query', cacheParams)

    // Try to get from cache
    const cachedResult = cache.get(cacheKey)
    if (cachedResult) {
        console.log(`Cache HIT: query`)
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.status(200).json(cachedResult)
        return
    }

    console.log(`Cache MISS: query`)
    res.set('X-Cache', 'MISS')

    // Store original json method
    const originalJson = res.json.bind(res)

    // Override json method to cache the response
    res.json = (data) => {
        // Only cache successful responses
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    console.log("CACHE STATS")
    console.log(cache.getStats())
    next()
}

/**
 * Cache middleware for search endpoint (word search)
 * Caches results based on search text and options
 */
const cacheSearch = (req, res, next) => {
    if (req.method !== 'POST' || !req.body) {
        return next()
    }

    const searchText = req.body?.searchText ?? req.body
    const searchOptions = req.body?.options ?? {}
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)

    const cacheParams = {
        searchText,
        options: searchOptions,
        limit,
        skip
    }
    const cacheKey = cache.generateKey('search', cacheParams)

    const cachedResult = cache.get(cacheKey)
    if (cachedResult) {
        console.log(`Cache HIT: search "${searchText}"`)
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.status(200).json(cachedResult)
        return
    }

    console.log(`Cache MISS: search "${searchText}"`)
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    console.log("CACHE STATS")
    console.log(cache.getStats())
    next()
}

/**
 * Cache middleware for phrase search endpoint
 * Caches results based on search phrase and options
 */
const cacheSearchPhrase = (req, res, next) => {
    if (req.method !== 'POST' || !req.body) {
        return next()
    }

    const searchText = req.body?.searchText ?? req.body
    const phraseOptions = req.body?.options ?? { slop: 2 }
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)

    const cacheParams = {
        searchText,
        options: phraseOptions,
        limit,
        skip
    }
    const cacheKey = cache.generateKey('searchPhrase', cacheParams)

    const cachedResult = cache.get(cacheKey)
    if (cachedResult) {
        console.log(`Cache HIT: search phrase "${searchText}"`)
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.status(200).json(cachedResult)
        return
    }

    console.log(`Cache MISS: search phrase "${searchText}"`)
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    console.log("CACHE STATS")
    console.log(cache.getStats())
    next()
}

/**
 * Cache middleware for ID lookup endpoint
 * Caches individual object lookups by ID
 */
const cacheId = (req, res, next) => {
    if (req.method !== 'GET') {
        return next()
    }

    const id = req.params['_id']
    if (!id) {
        return next()
    }

    const cacheKey = cache.generateKey('id', id)
    const cachedResult = cache.get(cacheKey)
    
    if (cachedResult) {
        console.log(`Cache HIT: id ${id}`)
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        // Apply same headers as the original controller
        res.set("Cache-Control", "max-age=86400, must-revalidate")
        res.status(200).json(cachedResult)
        return
    }

    console.log(`Cache MISS: id ${id}`)
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && data) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    console.log("CACHE STATS")
    console.log(cache.getStats())
    next()
}

/**
 * Cache middleware for history endpoint
 * Caches version history lookups by ID
 */
const cacheHistory = (req, res, next) => {
    if (req.method !== 'GET') {
        return next()
    }

    const id = req.params['_id']
    if (!id) {
        return next()
    }

    const cacheKey = cache.generateKey('history', id)
    const cachedResult = cache.get(cacheKey)
    
    if (cachedResult) {
        console.log(`Cache HIT: history ${id}`)
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.json(cachedResult)
        return
    }

    console.log(`Cache MISS: history ${id}`)
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    next()
}

/**
 * Cache middleware for since endpoint
 * Caches descendant version lookups by ID
 */
const cacheSince = (req, res, next) => {
    if (req.method !== 'GET') {
        return next()
    }

    const id = req.params['_id']
    if (!id) {
        return next()
    }

    const cacheKey = cache.generateKey('since', id)
    const cachedResult = cache.get(cacheKey)
    
    if (cachedResult) {
        console.log(`Cache HIT: since ${id}`)
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.json(cachedResult)
        return
    }

    console.log(`Cache MISS: since ${id}`)
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    next()
}

/**
 * Cache invalidation middleware for write operations
 * Invalidates cache entries when objects are created, updated, or deleted
 */
const invalidateCache = (req, res, next) => {
    console.log(`[CACHE INVALIDATE] Middleware triggered for ${req.method} ${req.path}`)
    
    // Store original response methods
    const originalJson = res.json.bind(res)
    const originalSend = res.send.bind(res)
    const originalSendStatus = res.sendStatus.bind(res)
    
    // Track if we've already performed invalidation to prevent duplicates
    let invalidationPerformed = false

    // Common invalidation logic
    const performInvalidation = (data) => {
        // Prevent duplicate invalidation
        if (invalidationPerformed) {
            console.log('[CACHE INVALIDATE] Skipping duplicate invalidation')
            return
        }
        invalidationPerformed = true
        
        console.log(`[CACHE INVALIDATE] Response handler called with status ${res.statusCode}`)
        
        // Only invalidate on successful write operations
        if (res.statusCode >= 200 && res.statusCode < 300) {
            // Use originalUrl to get the full path (req.path only shows the path within the mounted router)
            const path = req.originalUrl || req.path
            console.log(`[CACHE INVALIDATE] Processing path: ${path} (originalUrl: ${req.originalUrl}, path: ${req.path})`)
            
            // Determine what to invalidate based on the operation
            if (path.includes('/create') || path.includes('/bulkCreate')) {
                // For creates, use smart invalidation based on the created object's properties
                console.log('[CACHE INVALIDATE] Create operation detected - using smart cache invalidation')
                
                // Extract the created object(s)
                const createdObjects = path.includes('/bulkCreate') 
                    ? (Array.isArray(data) ? data : [data])
                    : [data?.new_obj_state ?? data]
                
                // Collect all property keys from created objects to invalidate matching queries
                const invalidatedKeys = new Set()
                
                for (const obj of createdObjects) {
                    if (!obj) continue
                    
                    // Invalidate caches that query for any property in the created object
                    // This ensures queries matching this object will be refreshed
                    cache.invalidateByObject(obj, invalidatedKeys)
                }
                
                console.log(`[CACHE INVALIDATE] Invalidated ${invalidatedKeys.size} cache entries using smart invalidation`)
                if (invalidatedKeys.size > 0) {
                    console.log(`[CACHE INVALIDATE] Invalidated keys: ${Array.from(invalidatedKeys).slice(0, 5).join(', ')}${invalidatedKeys.size > 5 ? '...' : ''}`)
                }
            } 
            else if (path.includes('/update') || path.includes('/patch') || 
                     path.includes('/set') || path.includes('/unset') ||
                     path.includes('/overwrite') || path.includes('/bulkUpdate')) {
                // For updates, use smart invalidation based on the updated object
                console.log('[CACHE INVALIDATE] Update operation detected - using smart cache invalidation')
                
                // Extract updated object (response may contain new_obj_state or the object directly)
                const updatedObject = data?.new_obj_state ?? data
                const objectId = updatedObject?._id ?? updatedObject?.["@id"]
                
                if (updatedObject && objectId) {
                    const invalidatedKeys = new Set()
                    
                    // Invalidate the specific ID cache for the NEW object
                    const idKey = `id:${objectId.split('/').pop()}`
                    cache.delete(idKey)
                    invalidatedKeys.add(idKey)
                    
                    // Extract version chain IDs
                    const objIdShort = objectId.split('/').pop()
                    const previousId = updatedObject?.__rerum?.history?.previous?.split('/').pop()
                    const primeId = updatedObject?.__rerum?.history?.prime?.split('/').pop()
                    
                    // CRITICAL: Also invalidate the PREVIOUS object's ID cache
                    // When UPDATE creates a new version, the old ID should show the old object
                    // but we need to invalidate it so clients get fresh data
                    if (previousId && previousId !== 'root') {
                        const prevIdKey = `id:${previousId}`
                        cache.delete(prevIdKey)
                        invalidatedKeys.add(prevIdKey)
                    }
                    
                    // Smart invalidation for queries that match this object
                    cache.invalidateByObject(updatedObject, invalidatedKeys)
                    
                    // Invalidate history/since for this object AND its version chain
                    // Build pattern that matches current, previous, and prime IDs
                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    const historyPattern = new RegExp(`^(history|since):(${versionIds})`)
                    const historyCount = cache.invalidate(historyPattern)
                    
                    console.log(`[CACHE INVALIDATE] Invalidated ${invalidatedKeys.size} cache entries (${historyCount} history/since for chain: ${versionIds})`)
                    if (invalidatedKeys.size > 0) {
                        console.log(`[CACHE INVALIDATE] Invalidated keys: ${Array.from(invalidatedKeys).slice(0, 5).join(', ')}${invalidatedKeys.size > 5 ? '...' : ''}`)
                    }
                } else {
                    // Fallback to broad invalidation if we can't extract the object
                    console.log('[CACHE INVALIDATE] Update operation (fallback - no object data)')
                    cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
                }
            }
            else if (path.includes('/delete')) {
                // For deletes, use smart invalidation based on the deleted object
                console.log('[CACHE INVALIDATE] Delete operation detected - using smart cache invalidation')
                
                // Get the deleted object from res.locals (set by delete controller before deletion)
                const deletedObject = res.locals.deletedObject
                const objectId = deletedObject?._id ?? deletedObject?.["@id"]
                
                if (deletedObject && objectId) {
                    const invalidatedKeys = new Set()
                    
                    // Invalidate the specific ID cache
                    const idKey = `id:${objectId.split('/').pop()}`
                    cache.delete(idKey)
                    invalidatedKeys.add(idKey)
                    
                    // Extract version chain IDs
                    const objIdShort = objectId.split('/').pop()
                    const previousId = deletedObject?.__rerum?.history?.previous?.split('/').pop()
                    const primeId = deletedObject?.__rerum?.history?.prime?.split('/').pop()
                    
                    // CRITICAL: Also invalidate the PREVIOUS object's ID cache
                    // When DELETE removes an object, the previous version may still be cached
                    if (previousId && previousId !== 'root') {
                        const prevIdKey = `id:${previousId}`
                        cache.delete(prevIdKey)
                        invalidatedKeys.add(prevIdKey)
                    }
                    
                    // Smart invalidation for queries that matched this object
                    cache.invalidateByObject(deletedObject, invalidatedKeys)
                    
                    // Invalidate history/since for this object AND its version chain
                    // Build pattern that matches current, previous, and prime IDs
                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    const historyPattern = new RegExp(`^(history|since):(${versionIds})`)
                    const historyCount = cache.invalidate(historyPattern)
                    
                    console.log(`[CACHE INVALIDATE] Invalidated ${invalidatedKeys.size} cache entries (${historyCount} history/since for chain: ${versionIds})`)
                    if (invalidatedKeys.size > 0) {
                        console.log(`[CACHE INVALIDATE] Invalidated keys: ${Array.from(invalidatedKeys).slice(0, 5).join(', ')}${invalidatedKeys.size > 5 ? '...' : ''}`)
                    }
                } else {
                    // Fallback to broad invalidation if we can't extract the object
                    console.log('[CACHE INVALIDATE] Delete operation (fallback - no object data from res.locals)')
                    cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
                }
            }
            else if (path.includes('/release')) {
                // Release creates a new version, invalidate all including history/since
                console.log('[CACHE INVALIDATE] Cache INVALIDATE: release operation')
                cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
            }
        }
    }

    // Override json method to invalidate cache after successful writes
    res.json = (data) => {
        performInvalidation(data)
        return originalJson(data)
    }

    // Override send method (used by some endpoints)
    res.send = (data) => {
        performInvalidation(data)
        return originalSend(data)
    }

    // Override sendStatus method (used by delete endpoint with 204 No Content)
    res.sendStatus = (statusCode) => {
        res.statusCode = statusCode
        // For delete operations, we need to get the object ID from params
        // Since there's no response data with 204, we can't do smart matching
        // Fallback: invalidate all caches (will be caught by the delete handler above)
        const deleteData = { "@id": req.params._id }
        performInvalidation(deleteData)
        return originalSendStatus(statusCode)
    }

    next()
}

/**
 * Middleware to expose cache statistics at /cache/stats endpoint
 */
const cacheStats = (req, res) => {
    const stats = cache.getStats()
    const details = req.query.details === 'true' ? cache.getStats() : undefined
    res.status(200).json(stats)
}

/**
 * Middleware to clear cache at /cache/clear endpoint
 * Should be protected in production
 */
const cacheClear = (req, res) => {
    const sizeBefore = cache.cache.size
    cache.clear()
    
    res.status(200).json({
        message: 'Cache cleared',
        entriesCleared: sizeBefore,
        currentSize: cache.cache.size
    })
}

/**
 * Cache middleware for GOG fragments endpoint
 * Caches POST requests for WitnessFragment entities from ManuscriptWitness
 * Cache key includes ManuscriptWitness URI and pagination parameters
 */
const cacheGogFragments = (req, res, next) => {
    // Only cache if request has valid body with ManuscriptWitness
    const manID = req.body?.["ManuscriptWitness"]
    if (!manID || !manID.startsWith("http")) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    
    // Generate cache key from ManuscriptWitness URI and pagination
    const cacheKey = `gog-fragments:${manID}:limit=${limit}:skip=${skip}`
    
    const cachedResponse = cache.get(cacheKey)
    if (cachedResponse) {
        console.log(`Cache HIT for GOG fragments: ${manID}`)
        res.set('X-Cache', 'HIT')
        res.set('Content-Type', 'application/json; charset=utf-8')
        res.json(cachedResponse)
        return
    }

    console.log(`Cache MISS for GOG fragments: ${manID}`)
    res.set('X-Cache', 'MISS')

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    next()
}

/**
 * Cache middleware for GOG glosses endpoint
 * Caches POST requests for Gloss entities from ManuscriptWitness
 * Cache key includes ManuscriptWitness URI and pagination parameters
 */
const cacheGogGlosses = (req, res, next) => {
    // Only cache if request has valid body with ManuscriptWitness
    const manID = req.body?.["ManuscriptWitness"]
    if (!manID || !manID.startsWith("http")) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    
    // Generate cache key from ManuscriptWitness URI and pagination
    const cacheKey = `gog-glosses:${manID}:limit=${limit}:skip=${skip}`
    
    const cachedResponse = cache.get(cacheKey)
    if (cachedResponse) {
        console.log(`Cache HIT for GOG glosses: ${manID}`)
        res.set('X-Cache', 'HIT')
        res.set('Content-Type', 'application/json; charset=utf-8')
        res.json(cachedResponse)
        return
    }

    console.log(`Cache MISS for GOG glosses: ${manID}`)
    res.set('X-Cache', 'MISS')

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data)
        }
        return originalJson(data)
    }

    next()
}

export {
    cacheQuery,
    cacheSearch,
    cacheSearchPhrase,
    cacheId,
    cacheHistory,
    cacheSince,
    cacheGogFragments,
    cacheGogGlosses,
    invalidateCache,
    cacheStats,
    cacheClear
}
