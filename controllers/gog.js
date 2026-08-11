#!/usr/bin/env node

/**
 * Gallery of Glosses (GOG) controller for RERUM operations
 * Handles specialized operations for the Gallery of Glosses application
 * @author cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { ObjectID, getAgentClaim, getPagination, parseDocumentID, idNegotiation, findLeafAnnotationsFor } from './utils.js'

// The Gallery of Glosses agents, by RERUM ObjectId.  Prod (store) and dev (devstore) mint different
// agents; only the trailing id is compared, so either host spelling matches.
const GOG_PROD_AGENT = "61043ad4ffce846a83e700dd"
const GOG_DEV_AGENT = "5afeebf3e4b0b0d588705d90"
const GOG_AGENTS = [GOG_PROD_AGENT, GOG_DEV_AGENT]

/**
 * THIS IS SPECIFICALLY FOR 'Gallery of Glosses'
 * Starting from a ManuscriptWitness URI get all WitnessFragment entities that are a part of the Manuscript.
 * The inbound request is a POST request with an Authorization header
 * The Bearer Token in the header must be from TinyMatt.
 * The body must be formatted correctly - {"ManuscriptWitness":"witness_uri_here"}
 *
 * TODO? Some sort of limit and skip for large responses?
 *
 * @return The set of {'@id':'123', '@type':'WitnessFragment'} objects that match this criteria, as an Array
 * */
const _gog_fragments_from_manuscript = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const agent = getAgentClaim(req, next)
    if (!agent) return
    const agentID = agent.split("/").pop()
    const manID = req.body["ManuscriptWitness"]
    const { limit, skip } = getPagination(req.query, 50)
    let err = { message: `` }
    // This request can only be made my Gallery of Glosses production apps.
    if (agentID !== GOG_PROD_AGENT) {
        err = Object.assign(err, {
            message: `Only the Gallery of Glosses can make this request.`,
            status: 403
        })
    }
    // Must have a properly formed body with a usable value
    else if(!manID || !manID.startsWith("http")){
        err = Object.assign(err, {
            message: `The body must be JSON like {"ManuscriptWitness":"witness_uri_here"}.`,
            status: 400
        })
    }
    if (err.status) {
        return next(utils.createExpressError(err))
    }
    try {
        let matches = []
        const partOfConditions = [
            {"body.partOf.value": manID.replace(/^https?/, "http")},
            {"body.partOf.value": manID.replace(/^https?/, "https")},
            {"body.partOf": manID.replace(/^https?/, "http")},
            {"body.partOf": manID.replace(/^https?/, "https")}
        ]
        const generatorConditions = [
            {"__rerum.generatedBy":  agent.replace(/^https?/, "http")},
            {"__rerum.generatedBy":  agent.replace(/^https?/, "https")}
        ]
        const fragmentTypeConditions = [
            {"witnessFragment.type": "WitnessFragment"},
            {"witnessFragment.@type": "WitnessFragment"}
        ]
        const annoTypeConditions = [
            {"type": "Annotation"},
            {"@type": "Annotation"},
            {"@type": "oa:Annotation"}
        ]
        let witnessFragmentPipeline = [
            // Step 1: Detect Annotations bodies noting their 'target' is 'partOf' this Manuscript
            {
                $match: {
                    "__rerum.history.next": { "$exists": true, "$size": 0 },
                    "$and":[
                        {"$or": annoTypeConditions},
                        {"$or": partOfConditions},
                        {"$or": generatorConditions}
                    ]
                }
            },
            // Step 1.1 through 1.3 for limit and skip functionality.
            { $sort : { _id: 1 } },
            { $skip : skip },
            { $limit : limit },
            // Step 2: Using the target of those Annotations lookup the Entity they represent and store them in a witnessFragment property on the Annotation
            // Note that $match had filtered down the alpha collection, so we use $lookup to look through the whole collection again.
            // FIXME? a target that is http will not match an @id that is https
            {
                $lookup: {
                    from: "alpha",
                    localField: "target",   // Field in `Annotation` referencing `@id` in `alpha` corresponding to a WitnessFragment @id
                    foreignField: "@id",
                    as: "witnessFragment"
                }
            },
            // Step 3: Filter out anything that is not a WitnessFragment entity (and a leaf)
            {
                $match: { 
                    "witnessFragment.__rerum.history.next": { "$exists": true, "$size": 0 },
                    "$or": fragmentTypeConditions
                }
            },
            // Step 4: Unwrap the Annotation and just return its corresponding WitnessFragment entity
            {
                $project: {
                    "_id": 0,
                    "@id": "$witnessFragment.@id",
                    "@type": "WitnessFragment"
                }
            },
            // Step 5: @id values are an Array of 1 and need to be a string instead
            {
                $unwind: { "path": "$@id" }
            }
            // Step 6: Cache it?
        ]

        // console.log("Start GoG WitnessFragment Aggregator")
        const start = Date.now()
        let witnessFragments = await db.aggregate(witnessFragmentPipeline).toArray()
        .then((fragments) => {
            if (fragments instanceof Error) {
              throw fragments
            }
            return fragments
        })
        const fragmentSet = new Set(witnessFragments)
        witnessFragments = Array.from(fragmentSet.values())
        // Note that a server side expand() is available and could be used to expand these fragments here.
        // console.log("End GoG WitnessFragment Aggregator")
        // console.log(witnessFragments.length+" fragments found for this Manuscript")
        // const end = Date.now()
        // console.log(`Total Execution time: ${end - start} ms`)
        res.set(utils.configureLDHeadersFor(witnessFragments))
        res.json(witnessFragments)
    }
    catch (error) {
        console.error(error)
        return next(utils.createExpressError(error))
    }
}

/**
 * THIS IS SPECIFICALLY FOR 'Gallery of Glosses'
 * Starting from a ManuscriptWitness URI get all Gloss entities that are a part of the Manuscript.
 * The inbound request is a POST request with an Authorization header.
 * The Bearer Token in the header must be from TinyMatt.
 * The body must be formatted correctly - {"ManuscriptWitness":"witness_uri_here"}
 *
 * TODO? Some sort of limit and skip for large responses?
 *
 * @return The set of {'@id':'123', '@type':'Gloss'} objects that match this criteria, as an Array
 * */
const _gog_glosses_from_manuscript = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const agent = getAgentClaim(req, next)
    if (!agent) return
    const agentID = agent.split("/").pop()
    const manID = req.body["ManuscriptWitness"]
    const { limit, skip } = getPagination(req.query, 50)
    let err = { message: `` }
    // This request can only be made my Gallery of Glosses production apps.
    if (agentID !== GOG_PROD_AGENT) {
        err = Object.assign(err, {
            message: `Only the Gallery of Glosses can make this request.`,
            status: 403
        })
    }
    // Must have a properly formed body with a usable value
    else if(!manID || !manID.startsWith("http")){
        err = Object.assign(err, {
            message: `The body must be JSON like {"ManuscriptWitness":"witness_uri_here"}.`,
            status: 400
        })
    }
    if (err.status) {
        return next(utils.createExpressError(err))
    }
    try {
        let matches = []
        const partOfConditions = [
            {"body.partOf.value": manID.replace(/^https?/, "http")},
            {"body.partOf.value": manID.replace(/^https?/, "https")},
            {"body.partOf": manID.replace(/^https?/, "http")},
            {"body.partOf": manID.replace(/^https?/, "https")}
        ]
        const generatorConditions = [
            {"__rerum.generatedBy":  agent.replace(/^https?/, "http")},
            {"__rerum.generatedBy":  agent.replace(/^https?/, "https")}
        ]
        const fragmentTypeConditions = [
            {"witnessFragment.type": "WitnessFragment"},
            {"witnessFragment.@type": "WitnessFragment"}
        ]
        const annoTypeConditions = [
            {"type": "Annotation"},
            {"@type": "Annotation"},
            {"@type": "oa:Annotation"}
        ]
        let glossPipeline = [
            // Step 1: Detect Annotations bodies noting their 'target' is 'partOf' this Manuscript
            {
                $match: {
                    "__rerum.history.next": { $exists: true, $size: 0 },
                    "$and":[
                        {"$or": annoTypeConditions},
                        {"$or": partOfConditions},
                        {"$or": generatorConditions}
                    ]
                }
            },
            // Step 1.1 through 1.3 for limit and skip functionality.
            { $sort : { _id: 1 } },
            { $skip : skip },
            { $limit : limit },
            // Step 2: Using the target of those Annotations lookup the Entity they represent and store them in a witnessFragment property on the Annotation
            // Note that $match had filtered down the alpha collection, so we use $lookup to look through the whole collection again.
            // FIXME? a target that is http will not match an @id that is https
            {
                $lookup: {
                    from: "alpha",
                    localField: "target",   // Field in `Annotation` referencing `@id` in `alpha` corresponding to a WitnessFragment @id
                    foreignField: "@id",
                    as: "witnessFragment"
                }
            },
            // Step 3: Filter Annotations to be only those which are for a WitnessFragment Entity
            {
                $match: { 
                    "$or": fragmentTypeConditions
                }
            },
            // Step 4: Unwrap the Annotation and just return its corresponding WitnessFragment entity
            {
                $project: {
                    "_id": 0,
                    "@id": "$witnessFragment.@id",
                    "@type": "WitnessFragment"
                }
            },
            // Step 5: @id values are an Array of 1 and need to be a string instead
            {
                $unwind: { "path": "$@id" }
            },
            // Step 6: Using the WitnessFragment ids lookup their references Annotations
            // Note that $match had filtered down the alpha collection, so we use $lookup to look through the whole collection again.
            {
                $lookup: {
                    from: "alpha",
                    localField: "@id",   // Field in `WitnessFragment` referencing `target` in `alpha` corresponding to a Gloss @id
                    foreignField: "target",
                    as: "anno"
                }
            },
            // Step 7: Filter Annos down to those that are the 'references' Annotations
            {
                $match: { 
                    "anno.body.references":{ "$exists": true }
                }
            },
            // Step 7: Collect together the body.references.value[] of those Annotations.  Those are the relevant Gloss URIs.
            {
                $project: {
                    "_id": 0,
                    "@id": "$anno.body.references.value",
                    "@type": "Gloss"
                }
            },
            // Step 8: @id values are an Array of and Array 1 because references.value is an Array
            {
                $unwind: { "path": "$@id" }
            },
            // Step 9: @id values are now an Array of 1 and need to be a string instead
            {
                $unwind: { "path": "$@id" }
            }
        ]

        // console.log("Start GoG Gloss Aggregator")
        // const start = Date.now()
        let glosses = await db.aggregate(glossPipeline).toArray()
        .then((fragments) => {
            if (fragments instanceof Error) {
              throw fragments
            }
            return fragments
          })
        const glossSet = new Set(glosses)
        glosses = Array.from(glossSet.values())
        // Note that a server side expand() is available and could be used to expand these fragments here.
        // console.log("End GoG Gloss Aggregator")
        // console.log(glosses.length+" Glosses found for this Manuscript")
        // const end = Date.now()
        // console.log(`Total Execution time: ${end - start} ms`)
        res.set(utils.configureLDHeadersFor(glosses))
        res.json(glosses)
    }
    catch (error) {
        console.error(error)
        return next(utils.createExpressError(error))
    }
}

/**
* Find relevant Annotations targeting a primitive RERUM entity.  This is a 'full' expand.
* Add the descriptive information in the Annotation bodies to the primitive object.
*
* Anticipate likely Annotation body formats
*   - anno.body
*   - anno.body.value
*
* Anticipate likely Annotation target formats
*   - target: 'uri'
*   - target: {'id':'uri'}
*   - target: {'@id':'uri'}
*
* Anticipate likely Annotation type formats
*   - {"type": "Annotation"}
*   - {"type": "oa:Annotation"}
*   - {"@type": "Annotation"}
*   - {"@type": "oa:Annotation"}
*
* @param primitiveEntity - An existing RERUM object
* @param GENERATOR - A registered RERUM app's User Agent
* @param CREATOR - Some kind of string representing a specific user.  Often combined with GENERATOR.
* @return the expanded entity object
*
*/
const expand = async function(primitiveEntity, GENERATOR=undefined, CREATOR=undefined){
    // An entity is expandable if it carries a URI under either '@id' or 'id'.
    if(!primitiveEntity?.["@id"] && !primitiveEntity?.id) return primitiveEntity
    const targetId = primitiveEntity["@id"] ?? primitiveEntity.id ?? "unknown"
    // Only expand with data from a specific app and/or a specific creator.  The shared helper
    // applies the leaf, target, and Annotation type constraints and doubles these two URIs
    // across the http/https spellings.
    const filters = {}
    if(GENERATOR) filters["__rerum.generatedBy"] = GENERATOR
    if(CREATOR) filters.creator = CREATOR
    const matches = await findLeafAnnotationsFor(targetId, filters)

    // Combine the Annotation bodies with the primitive object.
    // Mirror DEER's client-side expand() (deer-utils.js buildValueObject)
    // When more than one current Annotation asserts the same key, collect the values into an Array.
    let expandedEntity = structuredClone(primitiveEntity)
    for(const anno of matches){
        const body = anno.body
        // Array.isArray() as well as the typeof check.  An Array is a typeof 'object', and
        // Object.keys() on a one element Array is ["0"] -- a length of 1 that would pass the
        // single assertion check below and merge the body onto the entity under the key "0".
        // Annotations carrying multiple bodies are not expanded with.
        if(!body || typeof body !== "object" || Array.isArray(body)) continue
        const keys = Object.keys(body)
        if(keys.length !== 1) continue
        const key = keys[0]
        const assertion = body[key]
        const valueObject = {
            value: assertion?.value ?? assertion,
            source: assertion?.source ?? {
                citationSource: anno["@id"] ?? anno.id,
                citationNote: anno.label ?? anno.name ?? "Composed object from DEER",
                comment: "Learn about the assembler for this object at https://github.com/CenterForDigitalHumanities/deer"
            },
            evidence: assertion?.evidence ?? anno.evidence ?? ""
        }
        // Object.hasOwn() rather than the method on the entity.  A merged assertion named
        // 'hasOwnProperty' would shadow the method and throw a TypeError on the next iteration.
        if(Object.hasOwn(expandedEntity, key)){
            expandedEntity[key] = Array.isArray(expandedEntity[key])
                ? [...expandedEntity[key], valueObject]
                : [expandedEntity[key], valueObject]
        }
        else{
            expandedEntity[key] = valueObject
        }
    }

    return expandedEntity
}

/**
 * GET /gog/id/:_id
 * Return the RERUM object for :_id with the descriptive Annotations targeting it already merged in.
 * Mirrors the caching/negotiation behavior of the GET /v1/id/:_id handler in controllers/crud.js.
 * */
const expandedId = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const id = req.params["_id"]
    let err = { message: `` }
    try {
        let match = await db.findOne({ "$or": [{ "_id": id }, { "__rerum.slug": id }] })
        if (!match) {
            err = Object.assign(err, { message: `No RERUM object with id '${id}'`, status: 404 })
            return next(utils.createExpressError(err))
        }
        const generator = match.__rerum?.generatedBy
        const agentID = generator?.split("/").pop()
        if (!GOG_AGENTS.includes(agentID)) {
            err = Object.assign(err, {
                message: `This request can only be made for Gallery of Glosses generated data.`,
                status: 403
            })
            return next(utils.createExpressError(err))
        }
        // This '/gog/id' URI, not the entity URI.  This response is the expanded representation,
        // and the entity URI would hand back the unexpanded record instead.  Built off
        // RERUM_ID_PREFIX so the origin follows the deployment, and captured before expand() in
        // case idNegotiation() reaches the match itself and drops '_id'.
        const expandedLocation = new URL(`/gog/id/${match._id}`, process.env.RERUM_ID_PREFIX).href
        // Same browser-caching policy as GET /v1/id/:_id so this stable URI is cached (24h).
        res.set(utils.configureWebAnnoHeadersFor(match))
        res.set("Cache-Control", "max-age=86400, must-revalidate")
        // No Last-Modified here, unlike GET /v1/id/:_id.  It would compare against the root entity
        // before expand() merges the targeting Annotations.
        res.set("Current-Overwritten-Version", match.__rerum?.isOverwritten ?? "")
        let expanded = await expand(match, generator)
        expanded = idNegotiation(expanded)
        res.location(expandedLocation)
        res.json(expanded)
    } catch (error) {
        return next(utils.createExpressError(error))
    }
}

export { _gog_fragments_from_manuscript, _gog_glosses_from_manuscript, expand, expandedId }
