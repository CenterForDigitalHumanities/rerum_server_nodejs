#!/usr/bin/env node

/**
 * Gallery of Glosses (GOG) controller for RERUM operations
 * Handles specialized operations for the Gallery of Glosses application
 * @author cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation } from './utils.js'

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
    const agentID = agent.split("/").pop()
    const manID = req.body["ManuscriptWitness"]
    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    let err = { message: `` }
    // This request can only be made my Gallery of Glosses production apps.
    if (agentID !== "61043ad4ffce846a83e700dd") {
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
        next(createExpressError(err))
        return
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
        next(createExpressError(error))
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
    const agentID = agent.split("/").pop()
    const manID = req.body["ManuscriptWitness"]
    const limit = parseInt(req.query.limit ?? 50)
    const skip = parseInt(req.query.skip ?? 0)
    let err = { message: `` }
    // This request can only be made my Gallery of Glosses production apps.
    if (agentID !== "61043ad4ffce846a83e700dd") {
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
        next(createExpressError(err))
        return
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
        next(createExpressError(error))
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
    if(!primitiveEntity?.["@id"] || primitiveEntity?.id) return primitiveEntity
    const targetId = primitiveEntity["@id"] ?? primitiveEntity.id ?? "unknown"
    let queryObj = {
        "__rerum.history.next": { $exists: true, $size: 0 }
    }
    let targetPatterns = ["target", "target.@id", "target.id"]
    let targetConditions = []
    let annoTypeConditions = [{"type": "Annotation"}, {"@type":"Annotation"}, {"@type":"oa:Annotation"}]

    if (targetId.startsWith("http")) {
        for(const targetKey of targetPatterns){
            targetConditions.push({ [targetKey]: targetId.replace(/^https?/, "http") })
            targetConditions.push({ [targetKey]: targetId.replace(/^https?/, "https") })
        }
        queryObj["$and"] = [{"$or": targetConditions}, {"$or": annoTypeConditions}]
    } 
    else{
        queryObj["$or"] = annoTypeConditions
        queryObj.target = targetId
    }

    // Only expand with data from a specific app
    if(GENERATOR) {
        // Need to check http:// and https://
        const generatorConditions = [
            {"__rerum.generatedBy":  GENERATOR.replace(/^https?/, "http")},
            {"__rerum.generatedBy":  GENERATOR.replace(/^https?/, "https")}
        ]
        if (GENERATOR.startsWith("http")) {
            queryObj["$and"].push({"$or": generatorConditions })
        } 
        else{
            // It should be a URI, but this can be a fallback.
            queryObj["__rerum.generatedBy"] = GENERATOR
        }
    }
    // Only expand with data from a specific creator
    if(CREATOR) {
        // Need to check http:// and https://
        const creatorConditions = [
            {"creator":  CREATOR.replace(/^https?/, "http")},
            {"creator":  CREATOR.replace(/^https?/, "https")}
        ]
        if (CREATOR.startsWith("http")) {
            queryObj["$and"].push({"$or": creatorConditions })
        } 
        else{
            // It should be a URI, but this can be a fallback.
            queryObj["creator"] = CREATOR
        }
    }

    // Get the Annotations targeting this Entity from the db.  Remove _id property.
    let matches = await db.find(queryObj).toArray()
    matches = matches.map(o => {
        delete o._id
        return o
    })

    // Combine the Annotation bodies with the primitive object
    let expandedEntity = JSON.parse(JSON.stringify(primitiveEntity))
    for(const anno of matches){
        const body = anno.body
        let keys = Object.keys(body)
        if(!keys || keys.length !== 1) return
        let key = keys[0]
        let val = body[key].value ?? body[key]
        expandedEntity[key] = val
    }

    return expandedEntity
}

export { _gog_fragments_from_manuscript, _gog_glosses_from_manuscript, expand }
