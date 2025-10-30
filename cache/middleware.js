#!/usr/bin/env node

/**
 * Cache middleware for RERUM API routes
 * @author thehabes
 */

import cache from './index.js'

/**
 * Cache middleware for query endpoint
 */
const cacheQuery = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    if (req.method !== 'POST' || !req.body) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    
    const cacheParams = {
        body: req.body,
        limit,
        skip
    }
    const cacheKey = cache.generateKey('query', cacheParams)

    const cachedResult = await cache.get(cacheKey)
    if (cachedResult) {
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.status(200).json(cachedResult)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)

    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
    }
    next()
}

/**
 * Cache middleware for search endpoint (word search)
 */
const cacheSearch = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

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

    const cachedResult = await cache.get(cacheKey)
    if (cachedResult) {
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.status(200).json(cachedResult)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
    }
    next()
}

/**
 * Cache middleware for phrase search endpoint
 */
const cacheSearchPhrase = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

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

    const cachedResult = await cache.get(cacheKey)
    if (cachedResult) {
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.status(200).json(cachedResult)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
    }
    next()
}

/**
 * Cache middleware for ID lookup endpoint
 */
const cacheId = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    if (req.method !== 'GET') {
        return next()
    }

    const id = req.params['_id']
    if (!id) {
        return next()
    }

    const cacheKey = cache.generateKey('id', id)
    const cachedResult = await cache.get(cacheKey)
    
    if (cachedResult) {
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.set("Cache-Control", "max-age=86400, must-revalidate")
        res.status(200).json(cachedResult)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && data) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
    }
    next()
}

/**
 * Cache middleware for history endpoint
 */
const cacheHistory = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    if (req.method !== 'GET') {
        return next()
    }

    const id = req.params['_id']
    if (!id) {
        return next()
    }

    const cacheKey = cache.generateKey('history', id)
    const cachedResult = await cache.get(cacheKey)
    
    if (cachedResult) {
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.json(cachedResult)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
    }

    next()
}

/**
 * Cache middleware for since endpoint
 */
const cacheSince = async (req, res, next) => {
    if (process.env.CACHING !== 'true') {
        return next()
    }

    if (req.method !== 'GET') {
        return next()
    }

    const id = req.params['_id']
    if (!id) {
        return next()
    }

    const cacheKey = cache.generateKey('since', id)
    const cachedResult = await cache.get(cacheKey)
    
    if (cachedResult) {
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set('X-Cache', 'HIT')
        res.json(cachedResult)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
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
    
    let invalidationPerformed = false

    const performInvalidation = (data) => {
        if (invalidationPerformed) {
            return
        }
        invalidationPerformed = true
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
            const path = req.originalUrl || req.path
            
            if (path.includes('/create') || path.includes('/bulkCreate')) {
                const createdObjects = path.includes('/bulkCreate') 
                    ? (Array.isArray(data) ? data : [data])
                    : [data?.new_obj_state ?? data]
                
                const invalidatedKeys = new Set()
                
                for (const obj of createdObjects) {
                    if (!obj) continue
                    cache.invalidateByObject(obj, invalidatedKeys)
                }
            } 
            else if (path.includes('/update') || path.includes('/patch') || 
                     path.includes('/set') || path.includes('/unset') ||
                     path.includes('/overwrite') || path.includes('/bulkUpdate')) {
                
                const updatedObject = data?.new_obj_state ?? data
                const objectId = updatedObject?._id ?? updatedObject?.["@id"]
                
                if (updatedObject && objectId) {
                    const invalidatedKeys = new Set()
                    
                    const idKey = `id:${objectId.split('/').pop()}`
                    cache.delete(idKey)
                    invalidatedKeys.add(idKey)
                    
                    const objIdShort = objectId.split('/').pop()
                    const previousId = updatedObject?.__rerum?.history?.previous?.split('/').pop()
                    const primeId = updatedObject?.__rerum?.history?.prime?.split('/').pop()
                    
                    if (previousId && previousId !== 'root') {
                        const prevIdKey = `id:${previousId}`
                        cache.delete(prevIdKey)
                        invalidatedKeys.add(prevIdKey)
                    }
                    
                    cache.invalidateByObject(updatedObject, invalidatedKeys)
                    
                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    const historyPattern = new RegExp(`^(history|since):(${versionIds})`)
                    const historyCount = cache.invalidate(historyPattern)
                } else {
                    cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
                }
            }
            else if (path.includes('/delete')) {
                const deletedObject = res.locals.deletedObject
                const objectId = deletedObject?._id ?? deletedObject?.["@id"]
                
                if (deletedObject && objectId) {
                    const invalidatedKeys = new Set()
                    
                    const idKey = `id:${objectId.split('/').pop()}`
                    cache.delete(idKey)
                    invalidatedKeys.add(idKey)
                    
                    const objIdShort = objectId.split('/').pop()
                    const previousId = deletedObject?.__rerum?.history?.previous?.split('/').pop()
                    const primeId = deletedObject?.__rerum?.history?.prime?.split('/').pop()
                    
                    if (previousId && previousId !== 'root') {
                        const prevIdKey = `id:${previousId}`
                        cache.delete(prevIdKey)
                        invalidatedKeys.add(prevIdKey)
                    }
                    
                    cache.invalidateByObject(deletedObject, invalidatedKeys)
                    
                    const versionIds = [objIdShort, previousId, primeId].filter(id => id && id !== 'root').join('|')
                    const historyPattern = new RegExp(`^(history|since):(${versionIds})`)
                    const historyCount = cache.invalidate(historyPattern)
                } else {
                    cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
                }
            }
            else if (path.includes('/release')) {
                cache.invalidate(/^(query|search|searchPhrase|id|history|since):/)
            }
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
        const deleteData = { "@id": req.params._id }
        performInvalidation(deleteData)
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
    const statsBefore = await cache.getStats()
    const sizeBefore = statsBefore.length
    await cache.clear()

    res.status(200).json({
        message: 'Cache cleared',
        entriesCleared: sizeBefore,
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

    const manID = req.body?.["ManuscriptWitness"]
    if (!manID || !manID.startsWith("http")) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    
    const cacheKey = `gog-fragments:${manID}:limit=${limit}:skip=${skip}`
    
    const cachedResponse = await cache.get(cacheKey)
    if (cachedResponse) {
        res.set('X-Cache', 'HIT')
        res.set('Content-Type', 'application/json; charset=utf-8')
        res.json(cachedResponse)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
        }
        return originalJson(data)
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

    const manID = req.body?.["ManuscriptWitness"]
    if (!manID || !manID.startsWith("http")) {
        return next()
    }

    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    
    const cacheKey = `gog-glosses:${manID}:limit=${limit}:skip=${skip}`
    
    const cachedResponse = await cache.get(cacheKey)
    if (cachedResponse) {
        res.set('X-Cache', 'HIT')
        res.set('Content-Type', 'application/json; charset=utf-8')
        res.json(cachedResponse)
        return
    }
    res.set('X-Cache', 'MISS')

    const originalJson = res.json.bind(res)
    res.json = (data) => {
        if (res.statusCode === 200 && Array.isArray(data)) {
            cache.set(cacheKey, data).catch(err => console.error('Cache set error:', err))
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
