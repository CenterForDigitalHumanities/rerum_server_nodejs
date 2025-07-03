#!/usr/bin/env node

/**
 * PUT Update controller for RERUM operations
 * Handles PUT updates and import operations
 * @author Claude Sonnet 4, cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation, alterHistoryNext } from './utils.js'

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * This also detects an IMPORT situation.  If the object @id or id is not from RERUM
 * then trigger the internal _import function.
 * 
 * Track History
 * Respond RESTfully
 * */
const putUpdate = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let generatorAgent = getAgentClaim(req, next)
    const idReceived = objectReceived["@id"] ?? objectReceived.id
    if (idReceived) {
        if(!idReceived.includes(process.env.RERUM_ID_PREFIX)){
            //This is not a regular update.  This object needs to be imported, it isn't in RERUM yet.
            return _import(req, res, next)
        }
        let id = parseDocumentID(idReceived)
        let originalObject
        try {
            originalObject = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        } catch (error) {
            next(createExpressError(error))
            return
        }
        if (null === originalObject) {
            //This object is not found.
            err = Object.assign(err, {
                message: `Object not in RERUM even though it has a RERUM URI.  Check if it is an authentic RERUM object. ${err.message}`,
                status: 404
            })
        }
        else if (utils.isDeleted(originalObject)) {
            err = Object.assign(err, {
                message: `The object you are trying to update is deleted. ${err.message}`,
                status: 403
            })
        }
        else {
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
            console.log("UPDATE")
            try {
                let result = await db.insertOne(newObject)
                if (alterHistoryNext(originalObject, newObject["@id"])) {
                    //Success, the original object has been updated.
                    res.set(utils.configureWebAnnoHeadersFor(newObject))
                    newObject = idNegotiation(newObject)
                    newObject.new_obj_state = JSON.parse(JSON.stringify(newObject))
                    res.location(newObject[_contextid(newObject["@context"]) ? "id":"@id"])
                    res.status(200)
                    res.json(newObject)
                    return
                }
                err = Object.assign(err, {
                    message: `Unable to alter the history next of the originating object.  The history tree may be broken. See ${originalObject["@id"]}. ${err.message}`,
                    status: 500
                })
            }
            catch (error) {
                //WriteError or WriteConcernError
                next(createExpressError(error))
                return
            }
        }
    }
    else {
        //The http module will not detect this as a 400 on its own
        err = Object.assign(err, {
            message: `Object in request body must have an 'id' or '@id' property. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

/**
 * RERUM was given a PUT update request for an object whose @id was not from the RERUM API.
 * This PUT update request is instead considered internally as an "import".
 * We will create this object in RERUM, but its @id will be a RERUM URI.
 * __rerum.history.previous will point to the origial URI from the @id.
 * 
 * If this functionality were to be offered as its own endpoint, it would be a specialized POST create.
 * */
async function _import(req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let generatorAgent = getAgentClaim(req, next)
    const id = ObjectID()
    let context = objectReceived["@context"] ? { "@context": objectReceived["@context"] } : {}
    let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, objectReceived, false, true)["__rerum"] }
    delete objectReceived["__rerum"]
    delete objectReceived["_id"]
    delete objectReceived["@id"]
    // id is also protected in this case, so it can't be set.
    if(_contextid(objectReceived["@context"])) delete objectReceived.id
    delete objectReceived["@context"]
    
    let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, objectReceived, rerumProp, { "_id": id })
    console.log("IMPORT")
    try {
        let result = await db.insertOne(newObject)
        res.set(utils.configureWebAnnoHeadersFor(newObject))
        newObject = idNegotiation(newObject)
        newObject.new_obj_state = JSON.parse(JSON.stringify(newObject))
        res.location(newObject[_contextid(newObject["@context"]) ? "id":"@id"])
        res.status(200)
        res.json(newObject)
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        next(createExpressError(error))
    }
}

export { putUpdate }
