#!/usr/bin/env node

/**
 * Overwrite controller for RERUM operations
 * Handles overwrite operations with optimistic locking
 * @author cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation } from './utils.js'

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * DO NOT Track History
 * Respond RESTfully
 * */
const overwrite = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let agentRequestingOverwrite = getAgentClaim(req, next)
    const receivedID = objectReceived["@id"] ?? objectReceived.id
    if (receivedID) {
        console.log(`RERUM v1 PUT overwrite for ${receivedID}`)
        let id = parseDocumentID(receivedID)
        let originalObject
        try {
            originalObject = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        } catch (error) {
            next(createExpressError(error))
            return
        }
        if (null === originalObject) {
            err = Object.assign(err, {
                message: `No object with this id could be found in RERUM. Cannot overwrite. ${err.message}`,
                status: 404
            })
        }
        else if (utils.isDeleted(originalObject)) {
            err = Object.assign(err, {
                message: `The object you are trying to overwrite is deleted. ${err.message}`,
                status: 403
            })
        }
        else if (utils.isReleased(originalObject)) {
            err = Object.assign(err, {
                message: `The object you are trying to overwrite is released.  Fork with /update to make changes. ${err.message}`,
                status: 403
            })
        }
        else if (!utils.isGenerator(originalObject, agentRequestingOverwrite)) {
            err = Object.assign(err, {
                message: `You are not the generating agent for this object. You cannot overwrite it. Fork with /update to make changes. ${err.message}`,
                status: 401
            })
        }
        else {
            // Optimistic locking check - no expected version is a brutal overwrite
            const expectedVersion = req.get('If-Overwritten-Version') ?? req.body.__rerum?.isOverwritten
            const currentVersionTS = originalObject.__rerum?.isOverwritten ?? ""
            
            if (expectedVersion !== undefined && expectedVersion !== currentVersionTS) {
                console.log(`RERUM v1 says 'If-Overwritten-Version' header value '${expectedVersion}' does not match current version '${currentVersionTS}'`)
                console.log("overwrite 409")
                res.status(409)
                res.json({
                    currentVersion: originalObject
                })
                return
            }
            else {
                let context = objectReceived["@context"] ? { "@context": objectReceived["@context"] } : {}
                let rerumProp = { "__rerum": originalObject["__rerum"] }
                rerumProp["__rerum"].isOverwritten = new Date(Date.now()).toISOString().replace("Z", "")
                const id = originalObject["_id"]
                //Get rid of them so we can enforce the order
                delete objectReceived["@id"]
                delete objectReceived["_id"]
                delete objectReceived["__rerum"]
                // id is also protected in this case, so it can't be set.
                if(_contextid(objectReceived["@context"])) delete objectReceived.id
                delete objectReceived["@context"]
                let newObject = Object.assign(context, { "@id": originalObject["@id"] }, objectReceived, rerumProp, { "_id": id })
                let result
                try {
                    result = await db.replaceOne({ "_id": id }, newObject)
                } catch (error) {
                    next(createExpressError(error))
                    return
                }
                if (result.modifiedCount == 0) {
                    //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
                }
                // Include current version in response headers for future optimistic locking
                res.locals.previousObject = originalObject // Store for cache invalidation
                res.set('Current-Overwritten-Version', rerumProp["__rerum"].isOverwritten)
                res.set(utils.configureWebAnnoHeadersFor(newObject))
                newObject = idNegotiation(newObject)
                newObject.new_obj_state = JSON.parse(JSON.stringify(newObject))
                res.location(newObject[_contextid(newObject["@context"]) ? "id":"@id"])
                console.log(`PUT overwrite successful for ${newObject["@id"] ?? newObject.id}`)
                res.json(newObject)
                return
            }
        }
    }
    else {
        //This is a custom one, the http module will not detect this as a 400 on its own
        err = Object.assign(err, {
            message: `Object in request body must have the property '@id' or 'id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

export { overwrite }
