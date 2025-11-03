#!/usr/bin/env node

/**
 * Cache middleware for RERUM API routes
 * @author thehabes
 * 
 * 💡 OPTIMIZATION OPPORTUNITIES (Optional enhancements)

  After reviewing the code, here are suggested improvements ranked by value:

  HIGH VALUE:

  1. DRY Principle - Cache Key Generation (middleware.js)
    - Current: Repeated logic in 8 cache middleware functions
    - Opportunity: Extract common pattern (req, cacheKey) => cache.get(cacheKey) ? sendHit : setupMiss
    - Benefit: ~150 lines of code reduction, easier maintenance
    - Estimated effort: 30 minutes
  2. Consolidate Cache Check Logic (middleware.js)
    - Current: 6 cacheX middleware functions all check process.env.CACHING !== 'true'
    - Opportunity: Create higher-order wrapper function
    - Benefit: Single source of truth for cache enable check, cleaner code
    - Estimated effort: 20 minutes
 */

import cache from './index.js'

const sendCacheHit = (res, data, includeCacheControl = false) => {
    res.set('Content-Type', 'application/json; charset=utf-8')
    res.set('X-Cache', 'HIT')
    if (includeCacheControl) {
        res.set('Cache-Control', 'max-age=86400, must-revalidate')
    }
    res.status(200).json(data)
}

const setupCacheMiss = (res, cacheKey, validator) => {
    res.set('X-Cache', 'MISS')
    const originalJson = res.json.bind(res)
    res.json = (data) => {
        const validatorResult = validator(res.statusCode, data)
        
        if (validatorResult) {
            cache.set(cacheKey, data).catch(() => {})
        }
        return originalJson(data)
    }
}

const extractId = (url) => url?.split('/').pop() ?? null

/**
 * Cache middleware for query endpoint
 */
const cacheQuery = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'POST' || !req.body) {
        return next()
    }

    const cacheKey = cache.generateKey('query', {
        body: req.body,
        limit: parseInt(req.query.limit ?? 100),
        skip: parseInt(req.query.skip ?? 0)
    })

    const cachedResult = await cache.get(cacheKey)
    if (cachedResult) {
        sendCacheHit(res, cachedResult)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    next()
}

/**
 * Cache middleware for search endpoint (word search)
 */
const cacheSearch = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'POST' || !req.body) {
        return next()
    }

    const cacheKey = cache.generateKey('search', {
        searchText: req.body?.searchText ?? req.body,
        options: req.body?.options ?? {},
        limit: parseInt(req.query.limit ?? 100),
        skip: parseInt(req.query.skip ?? 0)
    })

    const cachedResult = await cache.get(cacheKey)
    if (cachedResult) {
        sendCacheHit(res, cachedResult)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    next()
}

/**
 * Cache middleware for phrase search endpoint
 */
const cacheSearchPhrase = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'POST' || !req.body) {
        return next()
    }

    const cacheKey = cache.generateKey('searchPhrase', {
        searchText: req.body?.searchText ?? req.body,
        options: req.body?.options ?? { slop: 2 },
        limit: parseInt(req.query.limit ?? 100),
        skip: parseInt(req.query.skip ?? 0)
    })

    const cachedResult = await cache.get(cacheKey)
    if (cachedResult) {
        sendCacheHit(res, cachedResult)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    next()
}

/**
 * Cache middleware for ID lookup endpoint
 */
const cacheId = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'GET') {
        return next()
    }

    const id = req.params._id
    if (!id) return next()

    const cacheKey = cache.generateKey('id', id)
    const cachedResult = await cache.get(cacheKey)
    
    if (cachedResult) {
        sendCacheHit(res, cachedResult, true)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && data)
    next()
}

/**
 * Cache middleware for history endpoint
 */
const cacheHistory = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'GET') {
        return next()
    }

    const id = req.params._id
    if (!id) return next()

    const cacheKey = cache.generateKey('history', id)
    const cachedResult = await cache.get(cacheKey)
    
    if (cachedResult) {
        sendCacheHit(res, cachedResult)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    next()
}

/**
 * Cache middleware for since endpoint
 */
const cacheSince = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'GET') {
        return next()
    }

    const id = req.params._id
    if (!id) return next()

    const cacheKey = cache.generateKey('since', id)
    const cachedResult = await cache.get(cacheKey)
    
    if (cachedResult) {
        sendCacheHit(res, cachedResult)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    next()
}

/**
 * Cache invalidation middleware for write operations
 * Invalidates affected cache entries when objects are created, updated, or deleted
 */
const invalidateCache = (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    const originalJson = res.json.bind(res)
    const originalSend = res.send.bind(res)
    const originalSendStatus = res.sendStatus.bind(res)
    
    let invalidationPerformed = false

    const performInvalidation = (data) => {
        if (invalidationPerformed || res.statusCode < 200 || res.statusCode >= 300) {
            return
        }
        invalidationPerformed = true

        const path = req.originalUrl || req.path

        if (path.includes('/create') || path.includes('/bulkCreate')) {
            const createdObjects = path.includes('/bulkCreate') 
                ? (Array.isArray(data) ? data : [data])
                : [data?.new_obj_state ?? data]
            
            const invalidatedKeys = new Set()
            for (const obj of createdObjects) {
                if (obj) {
                    cache.invalidateByObject(obj, invalidatedKeys)
                }
            }
        } 
        else if (path.includes('/update') || path.includes('/patch') || 
                 path.includes('/set') || path.includes('/unset') ||
                 path.includes('/overwrite') || path.includes('/bulkUpdate')) {
            
            const updatedObject = data?.new_obj_state ?? data
            const objectId = updatedObject?._id ?? updatedObject?.["@id"]
            
            if (updatedObject && objectId) {
                const invalidatedKeys = new Set()
                const objIdShort = extractId(objectId)
                const previousId = extractId(updatedObject?.__rerum?.history?.previous)
                const primeId = extractId(updatedObject?.__rerum?.history?.prime)
                
                cache.delete(`id:${objIdShort}`, true)  // Count as invalidation
                invalidatedKeys.add(`id:${objIdShort}`)
                
                if (previousId && previousId !== 'root') {
                    cache.delete(`id:${previousId}`, true)  // Count as invalidation
                    invalidatedKeys.add(`id:${previousId}`)
                }
                
                cache.invalidateByObject(updatedObject, invalidatedKeys)
                
                const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                if (versionIds) {
                    const regex = new RegExp(`^(history|since):(${versionIds})`)
                    cache.invalidate(regex)
                }
            } else {
                cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
            }
        }
        else if (path.includes('/delete')) {
            const deletedObject = res.locals.deletedObject
            const objectId = deletedObject?._id ?? deletedObject?.["@id"]
            
            if (deletedObject && objectId) {
                const invalidatedKeys = new Set()
                const objIdShort = extractId(objectId)
                const previousId = extractId(deletedObject?.__rerum?.history?.previous)
                const primeId = extractId(deletedObject?.__rerum?.history?.prime)
                
                cache.delete(`id:${objIdShort}`, true)  // Count as invalidation
                invalidatedKeys.add(`id:${objIdShort}`)
                
                if (previousId && previousId !== 'root') {
                    cache.delete(`id:${previousId}`, true)  // Count as invalidation
                    invalidatedKeys.add(`id:${previousId}`)
                }
                
                cache.invalidateByObject(deletedObject, invalidatedKeys)
                
                const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                if (versionIds) {
                    const regex = new RegExp(`^(history|since):(${versionIds})`)
                    cache.invalidate(regex)
                }
            } else {
                cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
            }
        }
        else if (path.includes('/release')) {
            cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
        }
    }

    res.json = (data) => {
        performInvalidation(data)
        return originalJson(data)
    }

    res.send = (data) => {
        performInvalidation(data)
        return originalSend(data)
    }

    res.sendStatus = (statusCode) => {
        res.statusCode = statusCode
        const objectForInvalidation = res.locals.deletedObject ?? { "@id": req.params._id, _id: req.params._id }
        performInvalidation(objectForInvalidation)
        return originalSendStatus(statusCode)
    }

    next()
}

/**
 * Expose cache statistics at /cache/stats endpoint
 */
const cacheStats = async (req, res) => {
    const includeDetails = req.query.details === 'true'
    const stats = await cache.getStats()
    
    if (includeDetails) {
        try {
            stats.details = await cache.getDetails()
        } catch (err) {
            stats.detailsError = err.message
        }
    }
    
    res.status(200).json(stats)
}

/**
 * Clear cache at /cache/clear endpoint (should be protected in production)
 */
const cacheClear = async (req, res) => {
    // Clear cache and wait for all workers to sync
    await cache.clear()
    await cache.waitForSync()

    res.status(200).json({
        message: 'Cache cleared',
        currentSize: 0
    })
}

/**
 * Cache middleware for GOG fragments endpoint
 */
const cacheGogFragments = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    const manID = req.body?.ManuscriptWitness
    if (!manID?.startsWith('http')) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    const cacheKey = cache.generateKey('gog-fragments', { manID, limit, skip })
    
    const cachedResponse = await cache.get(cacheKey)
    if (cachedResponse) {
        sendCacheHit(res, cachedResponse)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    next()
}

/**
 * Cache middleware for GOG glosses endpoint
 */
const cacheGogGlosses = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    const manID = req.body?.ManuscriptWitness
    if (!manID?.startsWith('http')) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    const cacheKey = cache.generateKey('gog-glosses', { manID, limit, skip })
    
    const cachedResponse = await cache.get(cacheKey)
    if (cachedResponse) {
        sendCacheHit(res, cachedResponse)
        return
    }

    setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
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
