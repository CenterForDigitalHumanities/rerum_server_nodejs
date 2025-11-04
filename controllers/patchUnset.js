#!/usr/bin/env node

/**
 * PATCH Unset controller for RERUM operations
 * Handles PATCH operations that remove keys
 * @author cubap, thehabes
 */

import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { _contextid, ObjectID, createExpressError, getAgentClaim, parseDocumentID, idNegotiation, alterHistoryNext } from './utils.js'

/**
 * Update some existing object in MongoDB by removing the keys noted in the JSON object in the request body.
 * Note that if a key on the request object does not match a key on the object in MongoDB, that key will be ignored.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * This cannot change existing keys or set new keys.
 * Track History
 * Respond RESTfully
 * */
const patchUnset = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let patchedObject = {}
    let generatorAgent = getAgentClaim(req, next)
    const receivedID = objectReceived["@id"] ?? objectReceived.id
    if (receivedID) {
        let id = parseDocumentID(receivedID)
        let originalObject
        try {
            originalObject = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
        } catch (error) {
            next(createExpressError(error))
            return
        }
        if (null === originalObject) {
            //This object is not in RERUM, they want to import it.  Do that automatically.  
            //updateExternalObject(objectReceived)
            err = Object.assign(err, {
                message: `This object is not from RERUM and will need imported. This is not automated yet. You can make a new object with create. ${err.message}`,
                status: 501
            })
        }
        else if (utils.isDeleted(originalObject)) {
            err = Object.assign(err, {
                message: `The object you are trying to update is deleted. ${err.message}`,
                status: 403
            })
        }
        else {
            patchedObject = JSON.parse(JSON.stringify(originalObject))
            delete objectReceived._id //can't unset this
            delete objectReceived.__rerum //can't unset this
            delete objectReceived["@id"] //can't unset this
            // id is also protected in this case, so it can't be unset.
            if(_contextid(originalObject["@context"])) delete objectReceived.id
            
            /**
             * unset does not alter an existing key.  It removes an existing key.
             * The request payload had {key:null} to flag keys to be removed.
             * Everything else is ignored.
            */
            for (let k in objectReceived) {
                if (originalObject.hasOwnProperty(k) && objectReceived[k] === null) {
                    delete patchedObject[k]
                }
                else {
                    //Note the possibility of notifying the user that these keys were not processed.
                    delete objectReceived[k]
                }
            }
            if (Object.keys(objectReceived).length === 0) {
                //Then you aren't actually changing anything...no properties in the request body were removed from the original object.
                //Just hand back the object.  The resulting of unsetting nothing is the object.
                res.set(utils.configureWebAnnoHeadersFor(originalObject))
                originalObject = idNegotiation(originalObject)
                originalObject.new_obj_state = JSON.parse(JSON.stringify(originalObject))
                res.location(originalObject[_contextid(originalObject["@context"]) ? "id":"@id"])
                res.status(200)
                res.json(originalObject)
                return
            }
            const id = ObjectID()
            let context = patchedObject["@context"] ? { "@context": patchedObject["@context"] } : {}
            let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, originalObject, true, false)["__rerum"] }
            delete patchedObject["__rerum"]
            delete patchedObject["_id"]
            delete patchedObject["@id"]
            // id is also protected in this case, so it can't be set.
            if(_contextid(patchedObject["@context"])) delete patchedObject.id
            delete patchedObject["@context"]
            let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, patchedObject, rerumProp, { "_id": id })
            try {
                let result = await db.insertOne(newObject)
                if (alterHistoryNext(originalObject, newObject["@id"])) {
                    //Success, the original object has been updated.
                    res.locals.previousObject = originalObject // Store for cache invalidation
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
            message: `Object in request body must have the property '@id' or 'id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

export { patchUnset }
