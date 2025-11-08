#!/usr/bin/env node

/**
 * Cache middleware for RERUM API routes
 * @author thehabes
 */

import cache from './index.js'
import { getAgentClaim } from '../controllers/utils.js'

const sendCacheHit = (res, data, includeCacheControl = false) => {
    res.set('Content-Type', 'application/json; charset=utf-8')
    res.set('X-Cache', 'HIT')
    // if (includeCacheControl) {
    //     res.set('Cache-Control', 'max-age=86400, must-revalidate')
    // }
    res.status(200).json(data)
}

const setupCacheMiss = (res, cacheKey, validator) => {
    res.set('X-Cache', 'MISS')
    const originalJson = res.json.bind(res)
    res.json = (data) => {
        const validatorResult = validator(res.statusCode, data)

        if (validatorResult) {
            cache.set(cacheKey, data).catch(err => {
                console.error('[Cache Error] Failed to set cache key:', err.message)
            })
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

    try {
        const cacheKey = cache.generateKey('query', {
            __cached: req.body,
            limit: parseInt(req.query.limit ?? 100),
            skip: parseInt(req.query.skip ?? 0)
        })

        const cachedResult = await cache.get(cacheKey)
        if (cachedResult) {
            sendCacheHit(res, cachedResult)
            return
        }

        setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for query:', err.message)
    }

    next()
}

/**
 * Cache middleware for search endpoint (word search)
 */
const cacheSearch = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'POST' || !req.body) {
        return next()
    }

    try {
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
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for search:', err.message)
    }

    next()
}

/**
 * Cache middleware for phrase search endpoint
 */
const cacheSearchPhrase = async (req, res, next) => {
    if (process.env.CACHING !== 'true' || req.method !== 'POST' || !req.body) {
        return next()
    }

    try {
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
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for searchPhrase:', err.message)
    }

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

    try {
        const cacheKey = cache.generateKey('id', id)
        const cachedResult = await cache.get(cacheKey)

        if (cachedResult) {
            sendCacheHit(res, cachedResult, true)
            return
        }

        setupCacheMiss(res, cacheKey, (status, data) => status === 200 && data)
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for ID lookup:', err.message)
    }

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

    try {
        const cacheKey = cache.generateKey('history', id)
        const cachedResult = await cache.get(cacheKey)

        if (cachedResult) {
            sendCacheHit(res, cachedResult)
            return
        }

        setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for history:', err.message)
    }

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

    try {
        const cacheKey = cache.generateKey('since', id)
        const cachedResult = await cache.get(cacheKey)

        if (cachedResult) {
            sendCacheHit(res, cachedResult)
            return
        }

        setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for since:', err.message)
    }

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
    const originalEnd = res.end.bind(res)

    let invalidationPerformed = false
    let invalidationPromise = null

    const performInvalidation = async (data) => {
        if (invalidationPerformed || res.statusCode < 200 || res.statusCode >= 300) {
            return
        }
        invalidationPerformed = true

        const startTime = Date.now()

        try {
            const path = req.originalUrl || req.path

            // OPTIMIZATION: Fetch all cache keys ONCE and reuse to avoid multiple IPC calls
            const allCacheKeys = await cache.getAllKeys()

            if (path.includes('/create') || path.includes('/bulkCreate')) {
                const createdObjects = path.includes('/bulkCreate')
                    ? (Array.isArray(data) ? data : [data])
                    : [data]

                const invalidatedKeys = new Set()
                for (const obj of createdObjects) {
                    if (obj) {
                        await cache.invalidateByObject(obj, invalidatedKeys, allCacheKeys)
                    }
                }
            }
            else if (path.includes('/update') || path.includes('/patch') ||
                     path.includes('/set') || path.includes('/unset') ||
                     path.includes('/overwrite') || path.includes('/bulkUpdate')) {
                const previousObject = res.locals.previousObject  // OLD version (what's currently in cache)
                const updatedObject = data  // NEW version
                const objectId = updatedObject?.["@id"] ?? updatedObject?.id ?? updatedObject?._id

                if (updatedObject && objectId) {
                    const invalidatedKeys = new Set()
                    const objIdShort = extractId(objectId)
                    const previousId = extractId(updatedObject?.__rerum?.history?.previous)
                    const primeId = extractId(updatedObject?.__rerum?.history?.prime)

                    if (!invalidatedKeys.has(`id:${objIdShort}`)) {
                        await cache.delete(`id:${objIdShort}`)
                        invalidatedKeys.add(`id:${objIdShort}`)
                    }

                    if (previousId && previousId !== 'root' && !invalidatedKeys.has(`id:${previousId}`)) {
                        await cache.delete(`id:${previousId}`)
                        invalidatedKeys.add(`id:${previousId}`)
                    }

                    // Invalidate based on PREVIOUS object (what's in cache) to match existing cached queries
                    if (previousObject) {
                        await cache.invalidateByObject(previousObject, invalidatedKeys, allCacheKeys)
                    }

                    // Also invalidate based on NEW object in case it matches different queries
                    await cache.invalidateByObject(updatedObject, invalidatedKeys, allCacheKeys)

                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    if (versionIds) {
                        const regex = new RegExp(`^(history|since):(${versionIds})`)
                        await cache.invalidate(regex, invalidatedKeys, allCacheKeys)
                    }
                } else {
                    console.error("An error occurred.  Cache is falling back to the nuclear option and removing all cache.")
                    console.log("Bad updated object")
                    console.log(updatedObject)
                    await cache.invalidate(/^(query|search|searchPhrase|id|history|since):/, new Set(), allCacheKeys)
                }
            }
            else if (path.includes('/delete')) {
                const deletedObject = res.locals.deletedObject
                const objectId =  deletedObject?.["@id"] ?? deletedObject?.id ?? deletedObject?._id

                if (deletedObject && objectId) {
                    const invalidatedKeys = new Set()
                    const objIdShort = extractId(objectId)
                    const previousId = extractId(deletedObject?.__rerum?.history?.previous)
                    const primeId = extractId(deletedObject?.__rerum?.history?.prime)

                    if (!invalidatedKeys.has(`id:${objIdShort}`)) {
                        await cache.delete(`id:${objIdShort}`)
                        invalidatedKeys.add(`id:${objIdShort}`)
                    }

                    if (previousId && previousId !== 'root' && !invalidatedKeys.has(`id:${previousId}`)) {
                        await cache.delete(`id:${previousId}`)
                        invalidatedKeys.add(`id:${previousId}`)
                    }

                    await cache.invalidateByObject(deletedObject, invalidatedKeys, allCacheKeys)

                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    if (versionIds) {
                        const regex = new RegExp(`^(history|since):(${versionIds})`)
                        await cache.invalidate(regex, invalidatedKeys, allCacheKeys)
                    }
                } else {
                    console.error("An error occurred.  Cache is falling back to the nuclear option and removing all cache.")
                    console.log("Bad deleted object")
                    console.log(deletedObject)
                    await cache.invalidate(/^(query|search|searchPhrase|id|history|since):/, new Set(), allCacheKeys)
                }
            }
            else if (path.includes('/release')) {
                const releasedObject = data
                const objectId = releasedObject?.["@id"] ?? releasedObject?.id ?? releasedObject?._id

                if (releasedObject && objectId) {
                    const invalidatedKeys = new Set()
                    const objIdShort = extractId(objectId)

                    // Invalidate specific ID cache
                    if (!invalidatedKeys.has(`id:${objIdShort}`)) {
                        await cache.delete(`id:${objIdShort}`)
                        invalidatedKeys.add(`id:${objIdShort}`)
                    }

                    // Invalidate queries matching this object
                    await cache.invalidateByObject(releasedObject, invalidatedKeys, allCacheKeys)

                    // Invalidate version chain caches
                    const previousId = extractId(releasedObject?.__rerum?.history?.previous)
                    const primeId = extractId(releasedObject?.__rerum?.history?.prime)
                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    if (versionIds) {
                        const regex = new RegExp(`^(history|since):(${versionIds})`)
                        await cache.invalidate(regex, invalidatedKeys, allCacheKeys)
                    }
                } else {
                    console.error("An error occurred.  Cache is falling back to the nuclear option and removing all cache.")
                    console.log("Bad released object")
                    console.log(releasedObject)
                    await cache.invalidate(/^(query|search|searchPhrase|id|history|since):/, new Set(), allCacheKeys)
                }
            }

            // Log performance warning for slow invalidations
            const duration = Date.now() - startTime
            if (duration > 200) {
                console.warn(`[Cache Performance] Slow invalidation: ${duration}ms for ${path}`)
            }
        } catch (err) {
            const duration = Date.now() - startTime
            console.error(`[CRITICAL] Cache invalidation failed after ${duration}ms:`, err.message)
            console.error('[CRITICAL] Cache may be stale. Manual cache clear recommended.')
        }
    }

    // COMPREHENSIVE FIX: Start invalidation when res.json/send is called
    // But don't send response yet - store the promise
    res.json = (data) => {
        invalidationPromise = performInvalidation(data)
        return originalJson(data)
    }

    res.send = (data) => {
        invalidationPromise = performInvalidation(data)
        return originalSend(data)
    }

    res.sendStatus = (statusCode) => {
        res.statusCode = statusCode
        const objectForInvalidation = res.locals.deletedObject ?? { "@id": req.params._id, id: req.params._id, _id: req.params._id }
        invalidationPromise = performInvalidation(objectForInvalidation)
        return originalSendStatus(statusCode)
    }

    // CRITICAL: Intercept res.end() to wait for invalidation before sending response
    res.end = function(...args) {
        if (invalidationPromise) {
            // Wait for invalidation to complete before actually ending the response
            invalidationPromise
                .then(() => originalEnd.apply(res, args))
                .catch(err => {
                    console.error('[CRITICAL] Invalidation failed during response:', err)
                    // Send response anyway to avoid hanging, but log critical error
                    originalEnd.apply(res, args)
                })
        } else {
            // No invalidation needed, send response immediately
            originalEnd.apply(res, args)
        }
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
 * Clear cache at /cache/clear endpoint
 */
const cacheClear = async (req, res) => {
    // Clear cache and wait for all workers to sync
    await cache.clear()

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

    try {
        // Extract agent from JWT to include in cache key for proper authorization
        const agent = getAgentClaim(req, next)
        if (!agent) return  // getAgentClaim already called next(err)
        const agentID = agent.split("/").pop()

        const limit = parseInt(req.query.limit ?? 50)
        const skip = parseInt(req.query.skip ?? 0)
        const cacheKey = cache.generateKey('gog-fragments', { agentID, manID, limit, skip })

        const cachedResponse = await cache.get(cacheKey)
        if (cachedResponse) {
            sendCacheHit(res, cachedResponse)
            return
        }

        setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for GOG fragments:', err.message)
    }

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

    try {
        // Extract agent from JWT to include in cache key for proper authorization
        const agent = getAgentClaim(req, next)
        if (!agent) return  // getAgentClaim already called next(err)
        const agentID = agent.split("/").pop()

        const limit = parseInt(req.query.limit ?? 50)
        const skip = parseInt(req.query.skip ?? 0)
        const cacheKey = cache.generateKey('gog-glosses', { agentID, manID, limit, skip })

        const cachedResponse = await cache.get(cacheKey)
        if (cachedResponse) {
            sendCacheHit(res, cachedResponse)
            return
        }

        setupCacheMiss(res, cacheKey, (status, data) => status === 200 && Array.isArray(data))
    } catch (err) {
        console.error('[Cache Error] Failed to get/set cache for GOG glosses:', err.message)
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
