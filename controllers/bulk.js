#!/usr/bin/env node

/**
 * Bulk operations controller for RERUM operations
 * Handles bulk create and bulk update operations
 * @author Claude Sonnet 4, cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation } from './utils.js'

/**
 * Create many objects at once with the power of MongoDB bulkWrite() operations.
 * 
 * @see https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
 */
const bulkCreate = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const documents = req.body
    let err = {}
    if (!Array.isArray(documents)) {
        err.message = "The request body must be an array of objects."
        err.status = 400
        next(createExpressError(err))
        return
    }
    if (documents.length === 0) {
        err.message = "No action on an empty array."
        err.status = 400
        next(createExpressError(err))
        return
    }
    const gatekeep = documents.filter(d=> {
        // Each item must be valid JSON, but can't be an array.
        if(Array.isArray(d) || typeof d !== "object") return d
        try {
            JSON.parse(JSON.stringify(d))
        } catch (err) {
            return d
        }
        // Items must not have an @id, and in some cases same for id.
        const idcheck = _contextid(d["@context"]) ? (d.id ?? d["@id"]) : d["@id"]
        if(idcheck) return d
    }) 
    if (gatekeep.length > 0) {
        err.message = "All objects in the body of a `/bulkCreate` must be JSON and must not contain a declared identifier property."
        err.status = 400
        next(createExpressError(err))
        return
    }

    // TODO: bulkWrite SLUGS? Maybe assign an id to each document and then use that to create the slug?
    // let slug = req.get("Slug")
    // if(slug){
    //     const slugError = await exports.generateSlugId(slug)
    //     if(slugError){
    //         next(createExpressError(slugError))
    //         return
    //     }
    //     else{
    //         slug = slug_json.slug_id
    //     }
    // }

    // unordered bulkWrite() operations have better performance metrics.
    let bulkOps = []
    const generatorAgent = getAgentClaim(req, next)
    for(let d of documents) {
        // Do not create empty {}s
        if(Object.keys(d).length === 0) continue
        const providedID = d?._id
        const id = isValidID(providedID) ? providedID : ObjectID()
        d = utils.configureRerumOptions(generatorAgent, d)
        // id is also protected in this case, so it can't be set.
        if(_contextid(d["@context"])) delete d.id
        d._id = id
        d['@id'] = `${process.env.RERUM_ID_PREFIX}${id}`
        bulkOps.push({ insertOne : { "document" : d }})
    }
    try {
        let dbResponse = await db.bulkWrite(bulkOps, {'ordered':false})
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set("Link",dbResponse.result.insertedIds.map(r => `${process.env.RERUM_ID_PREFIX}${r._id}`)) // https://www.rfc-editor.org/rfc/rfc5988
        res.status(201)
        const estimatedResults = bulkOps.map(f=>{
            let doc = f.insertOne.document
            doc = idNegotiation(doc)
            return doc
        })
        res.json(estimatedResults)  // https://www.rfc-editor.org/rfc/rfc7231#section-6.3.2
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        next(createExpressError(error))
    }
}

/**
 * Update many objects at once with the power of MongoDB bulkWrite() operations.
 * Make sure to alter object __rerum.history as appropriate.
 * The same object may be updated more than once, which will create history branches (not straight sticks)
 *
 * @see https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/
 */
const bulkUpdate = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const documents = req.body
    let err = {}
    let encountered = []
    if (!Array.isArray(documents)) {
        err.message = "The request body must be an array of objects."
        err.status = 400
        next(createExpressError(err))
        return
    }
    if (documents.length === 0) {
        err.message = "No action on an empty array."
        err.status = 400
        next(createExpressError(err))
        return
    }
    const gatekeep = documents.filter(d => {
        // Each item must be valid JSON, but can't be an array.
        if(Array.isArray(d) || typeof d !== "object") return d
        try {
            JSON.parse(JSON.stringify(d))
        } catch (err) {
            return d
        }
        // Items must have an @id, or in some cases an id will do
        const idcheck = _contextid(d["@context"]) ? (d.id ?? d["@id"]) : d["@id"]
        if(!idcheck) return d
    })
    // The empty {}s will cause this error
    if (gatekeep.length > 0) {
        err.message = "All objects in the body of a `/bulkUpdate` must be JSON and must contain a declared identifier property."
        err.status = 400
        next(createExpressError(err))
        return
    }
    // unordered bulkWrite() operations have better performance metrics.
    let bulkOps = []
    const generatorAgent = getAgentClaim(req, next)
    for(const objectReceived of documents){
        // We know it has an id
        const idReceived = objectReceived["@id"] ?? objectReceived.id
        // Update the same thing twice?  can vs should.
        // if(encountered.includes(idReceived)) continue
        encountered.push(idReceived)
        if(!idReceived.includes(process.env.RERUM_ID_PREFIX)) continue
        let id = parseDocumentID(idReceived)
        let originalObject
        try {
            originalObject = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        } catch (error) {
            next(createExpressError(error))
            return
        }
        if (null === originalObject) continue
        if (utils.isDeleted(originalObject)) continue
        id = ObjectID()
        let context = objectReceived["@context"] ? { "@context": objectReceived["@context"] } : {}
        let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, originalObject, true, false)["__rerum"] }
        delete objectReceived["__rerum"]
        delete objectReceived["_id"]
        delete objectReceived["@id"]
        // id is also protected in this case, so it can't be set.
        if(_contextid(objectReceived["@context"])) delete objectReceived.id
        delete objectReceived["@context"]
        let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, objectReceived, rerumProp, { "_id": id })
        bulkOps.push({ insertOne : { "document" : newObject }})
        if(originalObject.__rerum.history.next.indexOf(newObject["@id"]) === -1){
            originalObject.__rerum.history.next.push(newObject["@id"])
            const replaceOp = { replaceOne :
                {
                    "filter" : { "_id": originalObject["_id"] },
                    "replacement" : originalObject,
                    "upsert" : false
                }
            }
            bulkOps.push(replaceOp)
        }
    }
    try {
        let dbResponse = await db.bulkWrite(bulkOps, {'ordered':false})
        res.set("Content-Type", "application/json; charset=utf-8")
        res.set("Link", dbResponse.result.insertedIds.map(r => `${process.env.RERUM_ID_PREFIX}${r._id}`)) // https://www.rfc-editor.org/rfc/rfc5988
        res.status(200)
        const estimatedResults = bulkOps.filter(f=>f.insertOne).map(f=>{
            let doc = f.insertOne.document
            doc = idNegotiation(doc)
            return doc
        })
        res.json(estimatedResults)  // https://www.rfc-editor.org/rfc/rfc7231#section-6.3.2
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        next(createExpressError(error))
    }
}

export { bulkCreate, bulkUpdate }
