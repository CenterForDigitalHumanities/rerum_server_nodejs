#!/usr/bin/env node

/**
 * Basic CRUD operations for RERUM v1
 * @author Claude Sonnet 4, cubap, thehabes
 */
import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, idNegotiation, generateSlugId, ObjectID, createExpressError, getAgentClaim, parseDocumentID } from './utils.js'

/**
 * Merges and deduplicates results from multiple MongoDB Atlas Search index queries.
 * 
 * This function combines search results from both the IIIF Presentation API 3.0 index
 * (presi3AnnotationText) and the IIIF Presentation API 2.1 index (presi2AnnotationText).
 * 
 * @param {Array<Object>} results1 - Results from the first search index (typically IIIF 3.0)
 * @param {Array<Object>} results2 - Results from the second search index (typically IIIF 2.1)
 * @returns {Array<Object>} Merged array of unique results sorted by search score (descending)
 * 
 * @description
 * Process:
 * 1. Combines both result arrays
 * 2. Removes duplicates based on MongoDB _id (keeps first occurrence)
 * 3. Sorts by search score in descending order (highest relevance first)
 * 
 * The function handles different _id formats:
 * - ObjectId objects with $oid property
 * - String-based _id values
 *
 */
function mergeSearchResults(results1, results2) {
    const seen = new Set()
    const merged = []
    
    for (const result of [...results1, ...results2]) {
        const id = result._id?.$oid || result._id?.toString()
        if (!seen.has(id)) {
            seen.add(id)
            merged.push(result)
        }
    }
    
    // Sort by score descending
    return merged.sort((a, b) => (b.score || 0) - (a.score || 0))
}

/**
 * Builds parallel MongoDB Atlas Search aggregation pipelines for both IIIF 3.0 and 2.1 indexes.
 * 
 * This function creates two separate search queries that will be executed in parallel:
 * - One for IIIF Presentation API 3.0 resources (presi3AnnotationText index)
 * - One for IIIF Presentation API 2.1 resources (presi2AnnotationText index)
 * 
 * @param {string} searchText - The text query to search for
 * @param {Object} operator - Search operator configuration
 * @param {string} operator.type - Type of search operator: "text", "wildcard", "phrase", etc.
 * @param {Object} operator.options - Additional options for the search operator (e.g., fuzzy options)
 * @param {number} limit - Maximum number of results to return per index
 * @param {number} skip - Number of results to skip for pagination
 * @returns {Array<Array>} Two-element array containing [presi3Pipeline, presi2Pipeline]
 * 
 * @description
 * IIIF 3.0 Query Structure (presi3AnnotationText index):
 * - Searches direct text fields: body.value, bodyValue
 * - Searches embedded items: items.annotations.items.body.value
 * - Searches annotation items: annotations.items.body.value
 * - Uses compound query with "should" clauses (any match qualifies)
 * 
 * IIIF 2.1 Query Structure (presi2AnnotationText index):
 * - Searches Open Annotation fields: resource.chars, resource.cnt:chars
 * - Searches AnnotationList resources: resources[].resource.chars
 * - Searches Canvas otherContent: otherContent[].resources[].resource.chars
 * - Searches Manifest sequences: sequences[].canvases[].otherContent[].resources[].resource.chars
 * - Uses nested embeddedDocument operators for multi-level array traversal
 * 
 * Both queries use:
 * - $search stage with the specified operator type (text, wildcard, phrase, etc.)
 * - $addFields to include searchScore metadata
 * - $limit to cap results (limit + skip to allow for pagination)
 */
function buildDualIndexQueries(searchText, operator, limit, skip) {
    const presi3Query = {
        index: "presi3AnnotationText",
        compound: {
            should: [
                {
                    [operator.type]: {
                        query: searchText,
                        path: ["body.value", "bodyValue"],
                        ...operator.options
                    }
                },
                {
                    embeddedDocument: {
                        path: "items.annotations.items",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: ["items.annotations.items.body.value", "items.annotations.items.bodyValue"],
                                ...operator.options
                            }
                        }
                    }
                },
                {
                    embeddedDocument: {
                        path: "annotations",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: ["annotations.items.body.value", "annotations.items.bodyValue"],
                                ...operator.options
                            }
                        }
                    }
                },
                {
                    embeddedDocument: {
                        path: "annotations.items",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: ["annotations.items.body.value", "annotations.items.bodyValue"],
                                ...operator.options
                            }
                        }
                    }
                },
                {
                    embeddedDocument: {
                        path: "items",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: [
                                    "items.body.value",
                                    "items.bodyValue",
                                    "items.annotations.items.body.value",
                                    "items.annotations.items.bodyValue"
                                ],
                                ...operator.options
                            }
                        }
                    }
                }
            ],
            minimumShouldMatch: 1
        }
    }

    const presi2Query = {
        index: "presi2AnnotationText",
        compound: {
            should: [
                {
                    [operator.type]: {
                        query: searchText,
                        path: ["resource.chars", "resource.cnt:chars"],
                        ...operator.options
                    }
                },
                {
                    embeddedDocument: {
                        path: "resources",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: ["resources.resource.chars", "resources.resource.cnt:chars"],
                                ...operator.options
                            }
                        }
                    }
                },
                {
                    embeddedDocument: {
                        path: "otherContent.resources",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: ["otherContent.resources.resource.chars", "otherContent.resources.resource.cnt:chars"],
                                ...operator.options
                            }
                        }
                    }
                },
                {
                    embeddedDocument: {
                        path: "sequences.canvases.otherContent.resources",
                        operator: {
                            [operator.type]: {
                                query: searchText,
                                path: [
                                    "sequences.canvases.otherContent.resources.resource.chars",
                                    "sequences.canvases.otherContent.resources.resource.cnt:chars"
                                ],
                                ...operator.options
                            }
                        }
                    }
                }
            ],
            minimumShouldMatch: 1
        }
    }

    return [
        [
            { $search: presi3Query },
            { $addFields: { score: { $meta: "searchScore" } } },
            { $limit: limit + skip }
        ],
        [
            { $search: presi2Query },
            { $addFields: { score: { $meta: "searchScore" } } },
            { $limit: limit + skip }
        ]
    ]
}


/**
 * Standard text search endpoint - searches for exact word matches across both IIIF 3.0 and 2.1 resources.
 * 
 * @route POST /search
 * @param {Object} req.body - Request body containing search text
 * @param {string} req.body.searchText - The text to search for (can also be a plain string body)
 * @param {number} [req.query.limit=100] - Maximum number of results to return
 * @param {number} [req.query.skip=0] - Number of results to skip for pagination
 * @returns {Array<Object>} JSON array of matching annotation objects sorted by relevance score
 * 
 * @description
 * Performs a standard MongoDB Atlas Search text query that:
 * - Tokenizes the search text into words
 * - Searches for exact word matches (case-insensitive)
 * - Applies standard linguistic analysis (stemming, stop words, etc.)
 * - Searches across both IIIF Presentation API 3.0 and 2.1 indexes in parallel
 * - Returns results sorted by relevance score (highest first)
 * 
 * Search Behavior:
 * - "Bryan Haberberger" → finds documents containing both "Bryan" AND "Haberberger"
 * - Searches are case-insensitive
 * - Standard analyzer removes common stop words
 * - Partial word matches are NOT supported (use wildcardSearch for that)
 * 
 * IIIF 3.0 Fields Searched:
 * - body.value, bodyValue (direct annotation text)
 * - items.*.body.value (nested structures)
 * - annotations.*.body.value (canvas annotations)
 * 
 * IIIF 2.1 Fields Searched:
 * - resource.chars, resource.cnt:chars (direct annotation text)
 * - resources[].resource.chars (AnnotationList)
 * - otherContent[].resources[].resource.chars (Canvas)
 * - sequences[].canvases[].otherContent[].resources[].resource.chars (Manifest)
 * 
 * @example
 * POST /search
 * Body: {"searchText": "Hello World"}
 * Returns: All annotations containing "Hello" and "World"
 * 
 */
const searchAsWords = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let searchText = req.body?.searchText ?? req.body
    if (!searchText) {
        let err = {
            message: "You did not provide text to search for in the search request.",
            status: 400
        }
        next(utils.createExpressError(err))
        return
    }
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    
    const [queryPresi3, queryPresi2] = buildDualIndexQueries(searchText, { type: "text", options: {} }, limit, skip)
    
    try {
        const [resultsPresi3, resultsPresi2] = await Promise.all([
            db.aggregate(queryPresi3).toArray().catch((err) => { console.error("Presi3 error:", err.message); return [] }),
            db.aggregate(queryPresi2).toArray().catch((err) => { console.error("Presi2 error:", err.message); return [] })
        ])
        
        const merged = mergeSearchResults(resultsPresi3, resultsPresi2)
        const results = merged.slice(skip, skip + limit)
        
        res.set(utils.configureLDHeadersFor(results))
        res.json(results)
    } catch (error) {
        console.error(error)
        next(utils.createExpressError(error))
    }
}

/**
 * Phrase search endpoint - searches for multi-word phrases with words in proximity.
 * 
 * @route POST /phraseSearch
 * @param {Object} req.body - Request body containing search phrase
 * @param {string} req.body.searchText - The phrase to search for (can also be a plain string body)
 * @param {number} [req.query.limit=100] - Maximum number of results to return
 * @param {number} [req.query.skip=0] - Number of results to skip for pagination
 * @returns {Array<Object>} JSON array of matching annotation objects sorted by relevance score
 * 
 * @description
 * Performs a phrase search that finds documents where search terms appear near each other:
 * - Searches for terms in sequence or close proximity
 * - Allows up to 2 intervening words between search terms (slop: 2)
 * - More precise than standard text search for multi-word queries
 * - Searches across both IIIF Presentation API 3.0 and 2.1 indexes in parallel
 * 
 * Phrase Options:
 * - slop: 2 (allows up to 2 words between search terms)
 * 
 * Phrase Matching Examples (with slop: 2):
 * - "Bryan Haberberger" → matches:
 *   ✓ "Bryan Haberberger"
 *   ✓ "Bryan the Haberberger"
 *   ✓ "Bryan A. Haberberger"
 *   ✗ "Bryan loves to eat hamburgers with Haberberger" (too many words between)
 * 
 * - "manuscript illumination" → matches:
 *   ✓ "manuscript illumination"
 *   ✓ "manuscript and illumination"
 *   ✓ "illumination of manuscript" (reversed order with slop)
 *   ✓ "illuminated manuscript"
 * 
 * Use Cases:
 * - Finding exact or near-exact phrases
 * - Searching for names or titles
 * - Looking for specific multi-word concepts
 * - More precise than standard search, more flexible than exact match
 * 
 * Comparison with Other Search Types:
 * - Standard search: Finds "Bryan" AND "Haberberger" anywhere in document
 * - Phrase search: Finds "Bryan" near "Haberberger" (within 2 words)
 * - Exact match: Would require "Bryan Haberberger" with no intervening words
 * 
 * Performance:
 * - Generally faster than wildcard search
 * - Slower than standard text search due to proximity calculations
 * - Good balance of precision and recall
 * 
 * @example
 * POST /phraseSearch
 * Body: "medieval manuscript"
 * Returns: Annotations with "medieval" and "manuscript" in proximity
 */
const searchAsPhrase = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let searchText = req.body?.searchText ?? req.body
    if (!searchText) {
        let err = {
            message: "You did not provide text to search for in the search request.",
            status: 400
        }
        next(utils.createExpressError(err))
        return
    }
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    
    const phraseOptions = {
        slop: 2
    }
    
    const [queryPresi3, queryPresi2] = buildDualIndexQueries(searchText, { type: "phrase", options: phraseOptions }, limit, skip)
    
    try {
        const [resultsPresi3, resultsPresi2] = await Promise.all([
            db.aggregate(queryPresi3).toArray().catch(() => []),
            db.aggregate(queryPresi2).toArray().catch(() => [])
        ])
        
        const merged = mergeSearchResults(resultsPresi3, resultsPresi2)
        const results = merged.slice(skip, skip + limit)
        
        res.set(utils.configureLDHeadersFor(results))
        res.json(results)
    } catch (error) {
        console.error(error)
        next(utils.createExpressError(error))
    }
}

export {
    searchAsWords,
    searchAsPhrase
}
