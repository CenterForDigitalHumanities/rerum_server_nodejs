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
        res.json(cachedResult)
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
        res.json(cachedResult)
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
        res.json(cachedResult)
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
        res.json(cachedResult)
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
    // Store original json method
    const originalJson = res.json.bind(res)

    // Override json method to invalidate cache after successful writes
    res.json = (data) => {
        // Only invalidate on successful write operations
        if (res.statusCode >= 200 && res.statusCode < 300) {
            const path = req.path
            
            // Determine what to invalidate based on the operation
            if (path.includes('/create') || path.includes('/bulkCreate')) {
                // For creates, invalidate all queries and searches
                console.log('Cache INVALIDATE: create operation')
                cache.invalidate(/^(query|search|searchPhrase):/)
            } 
            else if (path.includes('/update') || path.includes('/patch') || 
                     path.includes('/overwrite') || path.includes('/bulkUpdate')) {
                // For updates, invalidate the specific ID, its history/since, and all queries/searches
                const id = data?._id ?? data?.["@id"]?.split('/').pop()
                if (id) {
                    console.log(`Cache INVALIDATE: update operation for ${id}`)
                    cache.invalidateById(id)
                    // Also invalidate history and since for this object and related objects
                    cache.invalidate(new RegExp(`^(history|since):`))
                } else {
                    // Fallback to invalidating everything
                    console.log('Cache INVALIDATE: update operation (full)')
                    cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
                }
            }
            else if (path.includes('/delete')) {
                // For deletes, invalidate the specific ID, its history/since, and all queries/searches
                const id = data?._id ?? req.body?.["@id"]?.split('/').pop()
                if (id) {
                    console.log(`Cache INVALIDATE: delete operation for ${id}`)
                    cache.invalidateById(id)
                    // Also invalidate history and since
                    cache.invalidate(new RegExp(`^(history|since):`))
                } else {
                    console.log('Cache INVALIDATE: delete operation (full)')
                    cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
                }
            }
            else if (path.includes('/release')) {
                // Release creates a new version, invalidate all including history/since
                console.log('Cache INVALIDATE: release operation')
                cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
            }
        }

        return originalJson(data)
    }

    next()
}

/**
 * Middleware to expose cache statistics at /cache/stats endpoint
 */
const cacheStats = (req, res) => {
    const stats = cache.getStats()
    const details = req.query.details === 'true' ? cache.getDetails() : undefined
    
    res.json({
        stats,
        details
    })
}

/**
 * Middleware to clear cache at /cache/clear endpoint
 * Should be protected in production
 */
const cacheClear = (req, res) => {
    const sizeBefore = cache.cache.size
    cache.clear()
    
    res.json({
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
