#!/usr/bin/env node

/**
 * Delete operations for RERUM v1
 * @author Claude Sonnet 4, cubap, thehabes
 */
import { newID, isValidID, db } from '../database/index.js'
import utils from '../utils.js'
import { createExpressError, getAgentClaim, parseDocumentID } from './utils.js'

/**
 * Mark an object as deleted in the database.
 * Support /v1/delete/{id}.  Note this is not v1/api/delete, that is not possible (XHR does not support DELETE with body)
 * Note /v1/delete/{blank} does not route here.  It routes to the generic 404.
 * Respond RESTfully
 * 
 * The user may be trying to call /delete and pass in the obj in the body.  XHR does not support bodies in delete.
 * If there is no id parameter, this is a 400
 * 
 * If there is an id parameter, we ignore body, and continue with that id
 * 
 * */
const deleteObj = async function(req, res, next) {
    let id
    let err = { message: `` }
    try {
        id = req.params["_id"] ?? parseDocumentID(JSON.parse(JSON.stringify(req.body))["@id"]) ?? parseDocumentID(JSON.parse(JSON.stringify(req.body))["id"])
    } catch(error){
        next(createExpressError(error))
        return
    }
    let agentRequestingDelete = getAgentClaim(req, next)
    let originalObject
    try {
        originalObject = await db.findOne({"$or":[{"_id": id}, {"__rerum.slug": id}]})
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null !== originalObject) {
        let safe_original = JSON.parse(JSON.stringify(originalObject))
        if (utils.isDeleted(safe_original)) {
            err = Object.assign(err, {
                message: `The object you are trying to delete is already deleted. ${err.message}`,
                status: 403
            })
        }
        else if (utils.isReleased(safe_original)) {
            err = Object.assign(err, {
                message: `The object you are trying to delete is released. Fork to make changes. ${err.message}`,
                status: 403
            })
        }
        else if (!utils.isGenerator(safe_original, agentRequestingDelete)) {
            err = Object.assign(err, {
                message: `You are not the generating agent for this object and so are not authorized to delete it. ${err.message}`,
                status: 401
            })
        }
        if (err.status) {
            next(createExpressError(err))
            return
        }
        let preserveID = safe_original["@id"]
        let deletedFlag = {} //The __deleted flag is a JSONObject
        deletedFlag["object"] = JSON.parse(JSON.stringify(originalObject))
        deletedFlag["deletor"] = agentRequestingDelete
        deletedFlag["time"] = new Date(Date.now()).toISOString().replace("Z", "")
        let deletedObject = {
            "@id": preserveID,
            "__deleted": deletedFlag,
            "_id": id
        }
        if (await healHistoryTree(safe_original)) {
            let result
            try {
                result = await db.replaceOne({ "_id": originalObject["_id"] }, deletedObject)
            } catch (error) {
                next(createExpressError(error))
                return
            }
            if (result.modifiedCount === 0) {
                //result didn't error out, the action was not performed.  Sometimes, this is a neutral thing.  Sometimes it is indicative of an error.
                err.message = "The original object was not replaced with the deleted object in the database."
                err.status = 500
                next(createExpressError(err))
                return
            }
            //204 to say it is deleted and there is nothing in the body
            console.log("Object deleted: " + preserveID)
            res.sendStatus(204)
            return
        }
        //Not sure we can get here, as healHistoryTree might throw and error.
        err.message = "The history tree for the object being deleted could not be mended."
        err.status = 500
        next(createExpressError(err))
        return
    }
    err.message = "No object with this id could be found in RERUM.  Cannot delete."
    err.status = 404
    next(createExpressError(err))
}

/**
* An internal method to handle when an object is deleted and the history tree around it will need amending.  
* This function should only be handed a reliable object from mongo.
* 
* @param obj A JSONObject of the object being deleted.
* @return A boolean representing whether or not this function succeeded. 
*/
async function healHistoryTree(obj) {
    let previous_id = ""
    let prime_id = ""
    let next_ids = []
    if (obj["__rerum"]) {
        previous_id = obj["__rerum"]["history"]["previous"]
        prime_id = obj["__rerum"]["history"]["prime"]
        next_ids = obj["__rerum"]["history"]["next"]
    }
    else {
        console.error("This object has no history because it has no '__rerum' property.  There is nothing to heal.")
        return false
    }
    let objToDeleteisRoot = (prime_id === "root")
    //Update the history.previous of all the next ids in the array of the deleted object
    try {
        for (const nextID of next_ids) {
            let objWithUpdate = {}
            const nextIdForQuery = parseDocumentID(nextID)
            const objToUpdate = await db.findOne({"$or":[{"_id": nextIdForQuery}, {"__rerum.slug": nextIdForQuery}]})
            if (null !== objToUpdate) {
                let fixHistory = JSON.parse(JSON.stringify(objToUpdate))
                if (objToDeleteisRoot) {
                    //This means this next object must become root. 
                    //Strictly, all history trees must have num(root) > 0.  
                    if (await newTreePrime(fixHistory)) {
                        fixHistory["__rerum"]["history"]["prime"] = "root"
                        //The previous always inherited in this case, even if it isn't there.
                        fixHistory["__rerum"]["history"]["previous"] = previous_id
                    }
                    else {
                        throw Error("Could not update all descendants with their new prime value")
                    }
                }
                else if (previous_id !== "") {
                    //The object being deleted had a previous.  That is now absorbed by this next object to mend the gap.  
                    fixHistory["__rerum"]["history"]["previous"] = previous_id
                }
                else {
                    throw Error("object did not have previous and was not root.")
                }
                let verify = await db.replaceOne({ "_id": objToUpdate["_id"] }, fixHistory)
                if (verify.modifiedCount === 0) {
                    throw Error("Could not update all descendants with their new prime value")
                }
            }
            else {
                throw Error("Could not update all descendants with their new prime value")
            }
        }
        if (previous_id.indexOf(process.env.RERUM_PREFIX) > -1) {
            let previousIdForQuery = parseDocumentID(previous_id)
            const objToUpdate2 = await db.findOne({"$or":[{"_id": previousIdForQuery}, {"__rerum.slug": previousIdForQuery}]})
            if (null !== objToUpdate2) {
                let fixHistory2 = JSON.parse(JSON.stringify(objToUpdate2))
                let origNextArray = fixHistory2["__rerum"]["history"]["next"]
                let newNextArray = [...origNextArray]
                newNextArray = newNextArray.filter(id => id !== obj["@id"])
                newNextArray = [...newNextArray, ...next_ids]
                fixHistory2["__rerum"]["history"]["next"] = newNextArray
                let verify2 = await db.replaceOne({ "_id": objToUpdate2["_id"] }, fixHistory2)
                if (verify2.modifiedCount === 0) {
                    throw Error("Could not update all ancestors with their altered next value")
                }
            }
            else {
                throw Error("Could not update all ancestors with their altered next value: cannot find ancestor.")
            }
        }
    } catch (error) {
        console.error(error)
        return false
    }
    return true
}

/**
* An internal method to make all descendants of this JSONObject take on a new history.prime = this object's @id
* This should only be fed a reliable object from mongo
* @param obj A new prime object whose descendants must take on its id
*/
async function newTreePrime(obj) {
    if (obj["@id"]) {
        let primeID = obj["@id"]
        let ls_versions = []
        let descendants = []
        try {
            ls_versions = await getAllVersions(obj)
            descendants = getAllDescendants(ls_versions, obj, [])
        } catch (error) {
            // fail silently
        }
        for (const d of descendants) {
            let objWithUpdate = JSON.parse(JSON.stringify(d))
            objWithUpdate["__rerum"]["history"]["prime"] = primeID
            let result = await db.replaceOne({ "_id": d["_id"] }, objWithUpdate)
            if (result.modifiedCount === 0) {
                console.error("Could not update all descendants with their new prime value: newTreePrime failed")
                return false
            }
        }
    }
    else {
        console.error("newTreePrime failed.  Obj did not have '@id'.")
        return false
    }
    return true
}

async function getAllVersions(obj) {
    let ls_versions
    let primeID = obj?.__rerum.history.prime
    let rootObj
    if (primeID === "root") {
        rootObj = JSON.parse(JSON.stringify(obj))
    } else if (primeID) {
        //Use _id for indexed query performance instead of @id
        const primeHexId = parseDocumentID(primeID)
        rootObj = await db.findOne({"$or":[{"_id": primeHexId}, {"__rerum.slug": primeHexId}]})
    } else {
        //primeID is undefined or null, cannot proceed
        throw new Error("Object has no valid history.prime value")
    }
    ls_versions = await db.find({ "__rerum.history.prime": rootObj['@id'] }).toArray()
    ls_versions.unshift(rootObj)
    return ls_versions
}

function getAllDescendants(ls_versions, keyObj, discoveredDescendants) {
    let nextIDarr = []
    if (keyObj.__rerum.history.next.length === 0) {
        //essentially, do nothing.  This branch is done.
    }
    else {
        nextIDarr = keyObj.__rerum.history.next
    }
    for (let nextID of nextIDarr) {
        for (let v of ls_versions) {
            if (v["@id"] === nextID) {
                discoveredDescendants.push(v)
                getAllDescendants(ls_versions, v, discoveredDescendants)
                break
            }
        }
    }
    return discoveredDescendants
}

export {
    deleteObj
}
