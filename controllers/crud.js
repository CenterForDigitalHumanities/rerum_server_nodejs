#!/usr/bin/env node

/**
 * Basic CRUD operations for RERUM v1
 * @author cubap, thehabes
 */
import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, idNegotiation, getPagination, generateSlugId, ObjectID, getAgentClaim, findLeafAnnotationsFor, PROTECTED_EXPANSION_KEYS } from './utils.js'

/**
 * Create a new Linked Open Data object in RERUM v1.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * Respond RESTfully
 * */
const create = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    if (!props || Object.keys(props).length === 0) {
        let err = {
            message: "Detected empty JSON object.  You must provide at least one property in the /create request body JSON.",
            status: 400
        }
        return next(utils.createExpressError(err))
    }
    let slug
    if(req.get("Slug")){
        let slug_json = await generateSlugId(req.get("Slug"), next)
        if(slug_json.code){
            return next(utils.createExpressError(slug_json))
        }
        else{
            slug = slug_json.slug_id
        }
    }
    
    let generatorAgent = getAgentClaim(req, next)
    if (!generatorAgent) return
    let context = req.body["@context"] ? { "@context": req.body["@context"] } : {}
    let provided = structuredClone(req.body)
    let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, provided, false, false)["__rerum"] }
    if(slug){
        rerumProp.__rerum.slug = slug
    }
    const providedID = provided._id
    const id = isValidID(providedID) ? providedID : ObjectID()
    delete provided["__rerum"]
    delete provided["@id"]
    // id is also protected in this case, so it can't be set.
    if(_contextid(provided["@context"])) delete provided.id
    delete provided["@context"]
    
    let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, provided, rerumProp, { "_id": id })
    try {
        let result = await db.insertOne(newObject)
        res.set(utils.configureWebAnnoHeadersFor(newObject))
        newObject = idNegotiation(newObject)
        newObject.new_obj_state = structuredClone(newObject)
        res.location(newObject[_contextid(newObject["@context"]) ? "id":"@id"])
        res.status(201)
        res.json(newObject)
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        return next(utils.createExpressError(error))
    }
}

/**
 * Query the MongoDB for objects containing the key:value pairs provided in the JSON Object in the request body.
 * This will support wildcards and mongo params like {"key":{$exists:true}}
 * The return is always an array, even if 0 or 1 objects in the return.
 * */
const query = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    const { limit, skip } = getPagination(req.query, 100)
    if (!props || Object.keys(props).length === 0) {
        //Hey now, don't ask for everything...this can happen by accident.  Don't allow it.
        let err = {
            message: "Detected empty JSON object.  You must provide at least one property in the /query request body JSON.",
            status: 400
        }
        return next(utils.createExpressError(err))
    }
    try {
        let matches = await db.find(props).limit(limit).skip(skip).toArray()
        matches = matches.map(o => idNegotiation(o))
        res.set(utils.configureLDHeadersFor(matches))
        res.json(matches)
    } catch (error) {
        return next(utils.createExpressError(error))
    }
}

/**
 * Query the MongoDB for objects with the _id provided in the request body or request URL
 * Note this specifically checks for _id, the @id pattern is irrelevant.  
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
const id = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    try {
        let match = await db.findOne({"$or": [{"_id": id}, {"__rerum.slug": id}]})
        if (match) {
            res.set(utils.configureWebAnnoHeadersFor(match))
            //Support built in browser caching
            res.set("Cache-Control", "max-age=86400, must-revalidate")
            //Support requests with 'If-Modified_Since' headers
            res.set(utils.configureLastModifiedHeader(match))
            // Include current version for optimistic locking
            const currentVersion = match.__rerum?.isOverwritten ?? ""
            res.set('Current-Overwritten-Version', currentVersion)
            match = idNegotiation(match)
            res.location(_contextid(match["@context"]) ? match.id : match["@id"])
            res.json(match)
            return
        }
        let err = {
            "message": `No RERUM object with id '${id}'`,
            "status": 404
        } 
        return next(utils.createExpressError(err))
    } catch (error) {
        return next(utils.createExpressError(error))
    }
}

/**
 * Reduce a supplied POST body to the literal MongoDB filter keys the expand job will honor.
 * @param supplied The parsed JSON request body.
 * @return An object of filter keys, minus the ones this endpoint owns.
 */
function sanitizeExpansionFilters(supplied) {
    /**
     * The expand job always constrains the Annotations it gathers to the leaf versions, to the
     * Annotation types, and to the entity in the request URI.  A client cannot influence those, so
     * these keys are dropped from a supplied filter body by exact name or dotted prefix.
     */
    const RESERVED_FILTER_KEYS = ["target", "type", "@type", "__rerum.history"]
    const filters = {}
    for (const [key, value] of Object.entries(supplied)) {
        if (RESERVED_FILTER_KEYS.some(reserved => key === reserved || key.startsWith(`${reserved}.`))) continue
        filters[key] = value
    }
    return filters
}

/**
 * The [key, value] assertions an Annotation makes about the entity it targets.
 * Only 'body' and 'bodyValue' are read -- an Annotation carrying neither is ignored, and no other
 * property of the Annotation can leak onto the entity.
 *
 * Anticipates the likely Annotation body formats
 *   - bodyValue: 'text'                                  the W3C shorthand, which has no key of its own
 *   - body: {'key': 'value'}                             a single assertion
 *   - body: {'key': {...}}                               a single assertion, value kept as-is
 *   - body: {'type':'TextualBody', 'value': 'text', ...} kept whole so 'format' and 'language' survive
 *   - body: {'@type':'oa:TextualBody', ...}              the OA prefixed spelling of the same
 *   - body: {'type':['TextualBody'], ...}                the same body, type serialized as a JSON-LD Array
 *   - body: [{'key': 'value'}]                           one body, serialized as a JSON-LD Array
 *
 * @param anno An Annotation document.
 * @return An Array of [key, value] pairs to merge onto the entity.
 */
function assertionsFrom(anno) {
    /**
     * The Annotation body types whose value is kept whole rather than read as a single assertion.
     */
    const TEXTUAL_BODY_TYPES = new Set(["TextualBody", "oa:TextualBody", "http://www.w3.org/ns/oa#TextualBody"])
    const assertions = []
    if (typeof anno.bodyValue === "string") assertions.push(["bodyValue", anno.bodyValue])
    // In JSON-LD a one-element Array and the bare value are the same body, so unwrap it first.  The
    // check below is about how many bodies an Annotation carries, not how they were serialized.
    const body = Array.isArray(anno.body) && anno.body.length === 1 ? anno.body[0] : anno.body
    // Skip Annotations carrying multiple bodies, and string bodies that are an IRI referencing an
    // external resource with no embedded value to expand with.
    if (Array.isArray(body) || !body || typeof body !== "object") return assertions
    // In JSON-LD a type is either a single value or an Array of them.  The query in
    // findLeafAnnotationsFor() matches both spellings, so both are read here too.
    const bodyType = body.type ?? body["@type"]
    const bodyTypes = Array.isArray(bodyType) ? bodyType : [bodyType]
    if (bodyTypes.some(t => TEXTUAL_BODY_TYPES.has(t))) {
        assertions.push(["bodyValue", body])
        return assertions
    }
    const keys = Object.keys(body)
    // Any other multi-key body is structural rather than assertional and cannot be attributed to a
    // single entity property.  This is what skips the Choice, Composite, and List multiplicity constructs.
    if (keys.length !== 1) return assertions
    assertions.push([keys[0], body[keys[0]]])
    return assertions
}

/**
 * Merge the assertions of the gathered Annotations onto a copy of the entity, as raw values.
 * When more than one current Annotation asserts the same key, or the entity already carries it, 
 * the values collect into an Array.
 * @param primitiveEntity The unexpanded entity.
 * @param annoAssertions An Array holding the [key, value] assertions read from each Annotation.
 * @return A new, expanded entity object.
 */
function applyExpansionAnnotations(primitiveEntity, annoAssertions) {
    const expandedEntity = structuredClone(primitiveEntity)
    // Hold __rerum aside so it can be re-appended after the merged properties. It will be the last property.
    const rerumProp = expandedEntity.__rerum
    delete expandedEntity.__rerum
    for (const assertions of annoAssertions) {
        for (const [key, value] of assertions) {
            if (PROTECTED_EXPANSION_KEYS.has(key)) continue
            if (!Object.hasOwn(expandedEntity, key)) {
                expandedEntity[key] = value
                continue
            }
            const existing = Array.isArray(expandedEntity[key]) ? expandedEntity[key] : [expandedEntity[key]]
            expandedEntity[key] = Array.isArray(value) ? [...existing, ...value] : [...existing, value]
        }
    }
    if (rerumProp !== undefined) expandedEntity.__rerum = rerumProp
    return expandedEntity
}

/**
 * Query the MongoDB for the object with the _id or __rerum.slug provided in the request URL, then
 * merge in the assertions of all the current leaf Annotations targeting it.
 *
 * GET recognizes the '?generator=' and '?creator=' convenience parameters only.
 * POST reads literal MongoDB filter keys from the JSON body and ignores URL parameters as filters.
 * Neither method pages.  A client asks once and receives the entity assembled.
 * */
const idExpanded = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const id = req.params["_id"]
    const isPost = req.method === "POST"
    let filters = {}
    if (isPost) {
        // Express leaves the body undefined when a POST supplies none.  That is an unfiltered expand.
        const supplied = req.body ?? {}
        if (typeof supplied !== "object" || Array.isArray(supplied)) {
            const err = {
                "message": "The /expanded request body must be a JSON object of filter properties.",
                "status": 400
            }
            return next(utils.createExpressError(err))
        }
        filters = sanitizeExpansionFilters(supplied)
    }
    else {
        // Repeated query parameters arrive as an Array, which is not a filter value we will apply.
        if (typeof req.query.generator === "string" && req.query.generator) filters["__rerum.generatedBy"] = req.query.generator
        if (typeof req.query.creator === "string" && req.query.creator) filters.creator = req.query.creator
    }
    try {
        const match = await db.findOne({"$or": [{"_id": id}, {"__rerum.slug": id}]})
        if (!match) {
            const err = {
                "message": `No RERUM object with id '${id}'`,
                "status": 404
            }
            return next(utils.createExpressError(err))
        }
        res.set(utils.configureWebAnnoHeadersFor(match))
        // Support built in browser caching.  A POST response is not cacheable.
        if (!isPost) res.set("Cache-Control", "max-age=86400, must-revalidate")
        // Include current version for optimistic locking
        res.set('Current-Overwritten-Version', match.__rerum?.isOverwritten ?? "")
        const targetId = match["@id"] ?? match.id
        const annos = targetId ? await findLeafAnnotationsFor(targetId, filters) : []
        // Every leaf Annotation matching the filter is gathered.  This is the count.
        res.set('Annotations-Gathered', String(annos.length))
        // Read each Annotation once.  These assertions are both the merged count and the merge itself.
        // How many of the Annotations contribute an assertion.  May be less than annotations gathered.
        const merged = annos.map(anno => assertionsFrom(anno)).filter(assertions => assertions.length > 0)
        res.set('Annotations-Merged', String(merged.length))
        let expanded = applyExpansionAnnotations(match, merged)
        expanded = idNegotiation(expanded)
        res.location(_contextid(expanded["@context"]) ? expanded.id : expanded["@id"])
        res.json(expanded)
    } catch (error) {
        return next(utils.createExpressError(error))
    }
}

export {
    create,
    query,
    id,
    idExpanded
}
