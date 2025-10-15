#!/usr/bin/env node

/**
 * Basic CRUD operations for RERUM v1
 * @author Claude Sonnet 4, cubap, thehabes
 */
import { db } from '../database/index.js'
import utils from '../utils.js'
import { idNegotiation, createExpressError } from './utils.js'

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
            { $addFields: { "__rerum.score": { $meta: "searchScore" } } },
            { $limit: limit + skip }
        ],
        [
            { $search: presi2Query },
            { $addFields: { "__rerum.score": { $meta: "searchScore" } } },
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
        next(createExpressError(err))
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
        let results = merged.slice(skip, skip + limit)
        results = results.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(results))
        res.json(results)
    } catch (error) {
        console.error(error)
        next(createExpressError(error))
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
        next(createExpressError(err))
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
        let results = merged.slice(skip, skip + limit)
        results = results.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(results))
        res.json(results)
    } catch (error) {
        console.error(error)
        next(createExpressError(error))
    }
}

/**
 * Fuzzy text search endpoint - searches for approximate matches allowing for typos and misspellings.
 * 
 * @route POST /fuzzySearch
 * @param {Object} req.body - Request body containing search text
 * @param {string} req.body.searchText - The text to search for (can also be a plain string body)
 * @param {number} [req.query.limit=100] - Maximum number of results to return
 * @param {number} [req.query.skip=0] - Number of results to skip for pagination
 * @returns {Array<Object>} JSON array of matching annotation objects sorted by relevance score
 * 
 * @description
 * Performs a fuzzy MongoDB Atlas Search that allows for approximate matches:
 * - Tolerates up to 1 character edit (insertion, deletion, substitution, transposition)
 * - Requires at least 2 characters to match exactly before fuzzy matching begins
 * - Expands to up to 50 similar terms
 * - Searches across both IIIF Presentation API 3.0 and 2.1 indexes in parallel
 * 
 * Fuzzy Options:
 * - maxEdits: 1 (allows one character difference)
 * - prefixLength: 2 (first 2 characters must match exactly)
 * - maxExpansions: 50 (considers up to 50 similar terms)
 * 
 * Search Behavior Examples:
 * - "Bryan" → matches "Bryan", "Brian" (1 edit)
 * - "Haberberger" → matches "Haberberger", "Haberburger" (1 edit)
 * - "manuscript" → matches "manuscript", "manuscripr" (1 edit)
 * - "ab" → only exact matches (too short for fuzzy, at prefixLength)
 * 
 * Use Cases:
 * - Handling user typos
 * - Finding names with spelling variations
 * - Searching when exact spelling is uncertain
 * - More lenient search than standard text search
 * 
 * Note: Fuzzy search typically returns more results than standard search and may
 * have slightly lower precision due to approximate matching.
 * 
 * @example
 * POST /fuzzySearch?limit=200
 * Body: "manuscripr"
 * Returns: Annotations containing "manuscript" (correcting the typo)
 */
const searchFuzzily = async function (req, res, next) {
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
    const fuzzyOptions = {
        fuzzy: {
            maxEdits: 1,
            prefixLength: 2,
            maxExpansions: 50
        }
    }
    const [queryPresi3, queryPresi2] = buildDualIndexQueries(searchText, { type: "text", options: fuzzyOptions }, limit, skip)
    try {
        const [resultsPresi3, resultsPresi2] = await Promise.all([
            db.aggregate(queryPresi3).toArray().catch(() => []),
            db.aggregate(queryPresi2).toArray().catch((error) => { console.error(error); return []; })
        ])
        const merged = mergeSearchResults(resultsPresi3, resultsPresi2)
        let results = merged.slice(skip, skip + limit)
        results = results.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(results))
        res.json(results)
    } catch (error) {
        console.error(error)
        next(utils.createExpressError(error))
    }
}

/**
 * Wildcard pattern search endpoint - searches using wildcard patterns for partial matches.
 * 
 * @route POST /wildcardSearch
 * @param {Object} req.body - Request body containing search pattern
 * @param {string} req.body.searchText - The wildcard pattern to search for (must contain * or ?)
 * @param {number} [req.query.limit=100] - Maximum number of results to return
 * @param {number} [req.query.skip=0] - Number of results to skip for pagination
 * @returns {Array<Object>} JSON array of matching annotation objects sorted by relevance score
 * 
 * @description
 * Performs a wildcard search using pattern matching:
 * - '*' matches zero or more characters (any length)
 * - '?' matches exactly one character
 * - Searches across both IIIF Presentation API 3.0 and 2.1 indexes in parallel
 * - Requires at least one wildcard character in the search pattern
 * 
 * Wildcard Options:
 * - allowAnalyzedField: true (enables wildcard search on analyzed text fields)
 * 
 * Pattern Matching Examples:
 * - "Bryan*" → matches "Bryan", "Bryanna", "Bryan Haberberger"
 * - "*berger" → matches "Haberberger", "hamburger", "cheeseburger"
 * - "B?yan" → matches "Bryan", "Broan", "Bruan"
 * - "man*script" → matches "manuscript", "manuscripts", "manuscript illumination"
 * - "*the*" → matches any text containing "the"
 * 
 * Use Cases:
 * - Searching for word prefixes or suffixes
 * - Finding variations of a term
 * - Partial word matching
 * - Pattern-based discovery
 * 
 * Important Notes:
 * - Search pattern MUST contain at least one wildcard (* or ?)
 * - Returns 400 error if no wildcards are present
 * - Wildcard searches may be slower than standard text searches
 * - Leading wildcards (*term) are less efficient but supported
 * 
 * Performance Tips:
 * - Avoid leading wildcards when possible ("term*" is faster than "*term")
 * - Be specific to reduce result set size
 * - Use with limit parameter for large result sets
 * 
 * @example
 * POST /wildcardSearch
 * Body: "*berger"
 * Returns: All annotations with words ending in "berger"
 * 
 * @example
 * POST /wildcardSearch
 * Body: "man?script"
 * Returns: Annotations matching "manuscript", "manuscript", etc.
 */
const searchWildly = async function (req, res, next) {
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
    // Require wildcards in the search text
    if (!searchText.includes('*') && !searchText.includes('?')) {
        let err = {
            message: "Wildcards must be used in wildcard search. Use '*' to match any characters or '?' to match a single character.",
            status: 400
        }
        next(utils.createExpressError(err))
        return
    }
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    const wildcardOptions = {
        allowAnalyzedField: true
    }
    const [queryPresi3, queryPresi2] = buildDualIndexQueries(searchText, { type: "wildcard", options: wildcardOptions }, limit, skip)
    try {
        const [resultsPresi3, resultsPresi2] = await Promise.all([
            db.aggregate(queryPresi3).toArray().catch(() => []),
            db.aggregate(queryPresi2).toArray().catch(() => [])
        ])
        const merged = mergeSearchResults(resultsPresi3, resultsPresi2)
        let results = merged.slice(skip, skip + limit)
        results = results.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(results))
        res.json(results)
    } catch (error) {
        console.error(error)
        next(utils.createExpressError(error))
    }
}

/**
 * "More Like This" search endpoint - finds documents similar to a provided example document.
 * 
 * @route POST /searchAlikes
 * @param {Object} req.body - A complete JSON document to use as the search example
 * @param {number} [req.query.limit=100] - Maximum number of results to return
 * @param {number} [req.query.skip=0] - Number of results to skip for pagination
 * @returns {Array<Object>} JSON array of similar annotation objects sorted by relevance score
 * 
 * @description
 * Performs a "moreLikeThis" search that finds documents similar to an example document:
 * - Analyzes the provided document's text content
 * - Extracts significant terms and patterns
 * - Finds other documents with similar content
 * - Uses both IIIF 3.0 (presi3AnnotationText) and IIIF 2.1 (presi2AnnotationText) indexes
 * - Great for discovery and finding related content
 * 
 * How It Works:
 * 1. You provide a complete JSON document (annotation, manifest, etc.)
 * 2. MongoDB Atlas Search extracts key terms from the document
 * 3. Searches for other documents containing similar terms
 * 4. Returns results ranked by similarity score
 * 
 * Use Cases:
 * - "Find more annotations like this one"
 * - Discovering related content after viewing a document
 * - Building recommendation systems
 * - Content clustering and grouping
 * - Finding duplicates or near-duplicates
 * 
 * Workflow:
 * 1. User performs standard search → gets results
 * 2. User selects an interesting result
 * 3. Pass that document to /searchAlikes
 * 4. Get more documents with similar content
 * 
 * Important Notes:
 * - Requires a full JSON document in request body (not just text)
 * - Searches both IIIF 3.0 (presi3AnnotationText) and IIIF 2.1 (presi2AnnotationText) indexes
 * - Returns 400 error if body is empty or invalid
 * - More effective with documents containing substantial text content
 * 
 * Input Document Structure:
 * - Can be any annotation object from your collection
 * - Should contain text in body.value, bodyValue, or nested fields
 * - The more text content, the better the similarity matching
 * 
 * @example
 * POST /searchAlikes
 * body: {
 *   "type": "Annotation",
 *   "body": {
 *     "value": "Medieval manuscript with gold leaf illumination..."
 *   }
 * }
 * Returns: Other annotations about medieval manuscripts and illumination
 * 
 * @example
 * // Typical workflow:
 * // 1. Search for "illuminated manuscripts"
 * const results = await fetch('/search', {body: {searchText: "illuminated manuscripts"}})
 * // 2. User likes result[0], find more like it
 * const similar = await fetch('/searchAlikes', {body: results[0]})
 */
const searchAlikes = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let likeDocument = req.body
    // Validate that a document was provided
    if (!likeDocument || (typeof likeDocument !== 'object') || Object.keys(likeDocument).length === 0) {
        let err = {
            message: "You must provide a JSON document in the request body to find similar documents.",
            status: 400
        }
        next(utils.createExpressError(err))
        return
    }
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    // Build moreLikeThis queries for both IIIF 3.0 and IIIF 2.1 indexes
    const searchQuery_presi3 = [
        {
            $search: {
                index: "presi3AnnotationText",
                moreLikeThis: {
                    like: Array.isArray(likeDocument) ? likeDocument : [likeDocument]
                }
            }
        },
        {
            $addFields: {
                "__rerum.score": { $meta: "searchScore" }
            }
        },
        {
            $limit: limit + skip  // Get extra to handle deduplication
        }
    ]
    const searchQuery_presi2 = [
        {
            $search: {
                index: "presi2AnnotationText",
                moreLikeThis: {
                    like: Array.isArray(likeDocument) ? likeDocument : [likeDocument]
                }
            }
        },
        {
            $addFields: {
                "__rerum.score": { $meta: "searchScore" }
            }
        },
        {
            $limit: limit + skip  // Get extra to handle deduplication
        }
    ]
    try {
        // Execute both queries in parallel
        const [results_presi3, results_presi2] = await Promise.all([
            db.aggregate(searchQuery_presi3).toArray(),
            db.aggregate(searchQuery_presi2).toArray()
        ])
        // Merge and deduplicate results
        const merged = mergeSearchResults(results_presi3, results_presi2)
        // Apply pagination after merging
        let results = merged.slice(skip, skip + limit)
        results = results.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(paginatedResults))
        res.json(paginatedResults)
    } catch (error) {
        console.error(error)
        next(utils.createExpressError(error))
    }
}

export {
    searchAsWords,
    searchAsPhrase,
    searchWildly,
    searchFuzzily,
    searchAlikes
}
