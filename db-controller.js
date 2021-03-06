#!/usr/bin/env node

/**
 * This module is used to connect to a mongodb instance and perform the necessary unit actions
 * to complete an API action.  The implementation is intended to be a RESTful API.  
 * Known database misteps, like NOT FOUND, should pass a RESTful message downstream.
 * 
 * It is used as middleware and so has access to the http module request and response objects, as well as next() 
 * 
 * @author thehabes 
 */

const { MongoClient } = require('mongodb')
var ObjectID = require('mongodb').ObjectId
const utils = require('./utils')
let client = new MongoClient(process.env.MONGO_CONNECTION_STRING)
client.connect()
console.log("DB controller was required by a module, so a connection must be made.  We would like there to only be one of these.")

// Handle index actions
exports.index = function (req, res, next) {
    res.json({
        status: "connected",
        message: "Not sure what to do"
    })
}

/**
 * Create a new Linked Open Data object in RERUM v1.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * Respond RESTfully
 * */
exports.create = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const id = req.get("Slug") ?? new ObjectID().toHexString()
    let generatorAgent = getAgentClaim(req, next)
    let context = req.body["@context"] ? { "@context": req.body["@context"] } : {}
    let provided = JSON.parse(JSON.stringify(req.body))
    let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, provided, false, false)["__rerum"] }
    delete provided["_rerum"]
    delete provided["_id"]
    delete provided["@id"]
    delete provided["@context"]
    let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, provided, rerumProp, { "_id": id })
    console.log("CREATE")
    try {
        let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
        res.set(utils.configureWebAnnoHeadersFor(newObject))
        res.location(newObject["@id"])
        res.status(201)
        delete newObject._id
        res.json(newObject)
    }
    catch (error) {
        //MongoServerError from the client has the following properties: index, code, keyPattern, keyValue
        next(createExpressError(error))
    }
}

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
exports.delete = async function (req, res, next) {
    let id = req.params["_id"]
    let err = { message: `` }
    let agentRequestingDelete = getAgentClaim(req, next)
    let originalObject
    try {
        originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null !== originalObject) {
        let safe_received = JSON.parse(JSON.stringify(originalObject))
        if (utils.isDeleted(safe_received)) {
            err = Object.assign(err, {
                message: `The object you are trying to update is deleted. ${err.message}`,
                status: 403
            })
        }
        if (utils.isReleased(safe_received)) {
            err = Object.assign(err, {
                message: `The object you are trying to update is released. Fork to make changes. ${err.message}`,
                status: 403
            })
        }
        if (!utils.isGenerator(safe_received, agentRequestingDelete)) {
            err = Object.assign(err, {
                message: `You are not the generating agent for this object. Fork with /update to make changes. ${err.message}`,
                status: 401
            })
        }
        if (err.status) {
            next(createExpressError(err))
            return
        }
        let preserveID = safe_received["@id"]
        let deletedFlag = {} //The __deleted flag is a JSONObject
        deletedFlag["object"] = JSON.parse(JSON.stringify(originalObject))
        deletedFlag["deletor"] = agentRequestingDelete
        deletedFlag["time"] = new Date(Date.now()).toISOString().replace("Z", "")
        let deletedObject = {
            "@id": preserveID,
            "__deleted": deletedFlag,
            "_id": id
        }
        if (healHistoryTree(safe_received)) {
            let result
            try {
                result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": originalObject["_id"] }, deletedObject)
            } catch (error) {
                next(createExpressError(error))
                return
            }
            if (result.modifiedCount === 0) {
                //result didn't error out, but it also didn't succeed...
                err.message = "The original object was not replaced with the deleted object in the database."
                err.status = 500
                next(createExpressError(err))
                return
            }
            //204 to say it is deleted and there is nothing in the body
            console.log("Object deleted: " + preserveID);
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
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * Track History
 * Respond RESTfully
 * */
exports.putUpdate = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let generatorAgent = getAgentClaim(req, next)
    if (objectReceived["@id"]) {
        let updateHistoryNextID = objectReceived["@id"]
        let id = objectReceived["@id"].replace(process.env.RERUM_ID_PREFIX, "")
        let originalObject
        try {
            originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
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
            const id = new ObjectID().toHexString()
            let context = objectReceived["@context"] ? { "@context": objectReceived["@context"] } : {}
            let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, originalObject, true, false)["__rerum"] }
            delete objectReceived["_rerum"]
            delete objectReceived["_id"]
            delete objectReceived["@id"]
            delete objectReceived["@context"]
            let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, objectReceived, rerumProp, { "_id": id })
            console.log("UPDATE")
            try {
                let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
                if (alterHistoryNext(originalObject, newObject["@id"])) {
                    //Success, the original object has been updated.
                    res.set(utils.configureWebAnnoHeadersFor(newObject))
                    res.location(newObject["@id"])
                    res.status(200)
                    delete newObject._id
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
            message: `Object in request body must have the property '@id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

/**
 * Update some existing object in MongoDB with the JSON object in the request body.
 * Note that only keys that exist on the object will be respected.  This cannot set or unset keys.  
 * If there is nothing to PATCH, return a 200 with the object in the response body. 
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * Track History
 * Respond RESTfully
 * */
exports.patchUpdate = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let patchedObject = {}
    let generatorAgent = getAgentClaim(req, next)
    if (objectReceived["@id"]) {
        let updateHistoryNextID = objectReceived["@id"]
        let id = objectReceived["@id"].replace(process.env.RERUM_ID_PREFIX, "")
        let originalObject
        try {
            originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
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
            delete objectReceived.__rerum //can't patch this
            delete objectReceived._id //can't patch this
            delete objectReceived["@id"] //can't patch this
            //A patch only alters existing keys.  Remove non-existent keys from the object received in the request body.
            for (let k in objectReceived) {
                if (originalObject.hasOwnProperty(k)) {
                    if (objectReceived[k] === null) {
                        delete patchedObject[k]
                    }
                    else {
                        patchedObject[k] = objectReceived[k]
                    }
                }
                else {
                    //Note the possibility of notifying the user that these keys were not processed.
                    delete objectReceived[k]
                }
            }
            if (Object.keys(objectReceived).length === 0) {
                //Then you aren't actually changing anything...only @id came through
                //Just hand back the object.  The resulting of patching nothing is the object unchanged.
                res.set(utils.configureWebAnnoHeadersFor(originalObject))
                res.location(originalObject["@id"])
                res.status(200)
                delete originalObject._id
                res.json(originalObject)
                return
            }
            const id = new ObjectID().toHexString()
            let context = patchedObject["@context"] ? { "@context": patchedObject["@context"] } : {}
            let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, originalObject, true, false)["__rerum"] }
            delete patchedObject["_rerum"]
            delete patchedObject["_id"]
            delete patchedObject["@id"]
            delete patchedObject["@context"]
            let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, patchedObject, rerumProp, { "_id": id })
            console.log("PATCH UPDATE")
            try {
                let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
                if (alterHistoryNext(originalObject, newObject["@id"])) {
                    //Success, the original object has been updated.
                    res.set(utils.configureWebAnnoHeadersFor(newObject))
                    res.location(newObject["@id"])
                    res.status(200)
                    delete newObject._id
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
            message: `Object in request body must have the property '@id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

/**
 * Update some existing object in MongoDB by adding the keys from the JSON object in the request body.
 * Note that if a key on the request object matches a key on the object in MongoDB, that key will be ignored.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * This cannot change or unset existing keys.
 * Track History
 * Respond RESTfully
 * */
exports.patchSet = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let patchedObject = {}
    let generatorAgent = getAgentClaim(req, next)
    if (objectReceived["@id"]) {
        let updateHistoryNextID = objectReceived["@id"]
        let id = objectReceived["@id"].replace(process.env.RERUM_ID_PREFIX, "")
        let originalObject
        try {
            originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
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
            //A set only adds new keys.  If the original object had the key, it is ignored here.
            for (let k in objectReceived) {
                if (originalObject.hasOwnProperty(k)) {
                    //Note the possibility of notifying the user that these keys were not processed.
                    delete objectReceived[k]
                }
                else {
                    patchedObject[k] = objectReceived[k]
                }
            }
            if (Object.keys(objectReceived).length === 0) {
                //Then you aren't actually changing anything...there are no new properties
                //Just hand back the object.  The resulting of setting nothing is the object from the request body.
                res.set(utils.configureWebAnnoHeadersFor(originalObject))
                res.location(originalObject["@id"])
                res.status(200)
                delete originalObject._id
                res.json(originalObject)
                return
            }
            const id = new ObjectID().toHexString()
            let context = patchedObject["@context"] ? { "@context": patchedObject["@context"] } : {}
            let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, originalObject, true, false)["__rerum"] }
            delete patchedObject["_rerum"]
            delete patchedObject["_id"]
            delete patchedObject["@id"]
            delete patchedObject["@context"]
            let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, patchedObject, rerumProp, { "_id": id })
            try {
                let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
                if (alterHistoryNext(originalObject, newObject["@id"])) {
                    //Success, the original object has been updated.
                    res.set(utils.configureWebAnnoHeadersFor(newObject))
                    res.location(newObject["@id"])
                    res.status(200)
                    delete newObject._id
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
            message: `Object in request body must have the property '@id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

/**
 * Update some existing object in MongoDB by removing the keys noted in the JSON object in the request body.
 * Note that if a key on the request object does not match a key on the object in MongoDB, that key will be ignored.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * This cannot change existing keys or set new keys.
 * Track History
 * Respond RESTfully
 * */
exports.patchUnset = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = JSON.parse(JSON.stringify(req.body))
    let patchedObject = {}
    let generatorAgent = getAgentClaim(req, next)
    if (objectReceived["@id"]) {
        let updateHistoryNextID = objectReceived["@id"]
        let id = objectReceived["@id"].replace(process.env.RERUM_ID_PREFIX, "")
        let originalObject
        try {
            originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
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
                res.location(originalObject["@id"])
                res.status(200)
                delete originalObject._id
                res.json(originalObject)
                return
            }
            const id = new ObjectID().toHexString()
            let context = patchedObject["@context"] ? { "@context": patchedObject["@context"] } : {}
            let rerumProp = { "__rerum": utils.configureRerumOptions(generatorAgent, originalObject, true, false)["__rerum"] }
            delete patchedObject["_rerum"]
            delete patchedObject["_id"]
            delete patchedObject["@id"]
            delete patchedObject["@context"]
            let newObject = Object.assign(context, { "@id": process.env.RERUM_ID_PREFIX + id }, patchedObject, rerumProp, { "_id": id })
            console.log("PATCH UNSET")
            try {
                let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
                if (alterHistoryNext(originalObject, newObject["@id"])) {
                    //Success, the original object has been updated.
                    res.set(utils.configureWebAnnoHeadersFor(newObject))
                    res.location(newObject["@id"])
                    res.status(200)
                    delete newObject._id
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
            message: `Object in request body must have the property '@id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * Order the properties to preference @context and @id.  Put __rerum and _id last. 
 * DO NOT Track History
 * Respond RESTfully
 * */
exports.overwrite = async function (req, res, next) {
    let err = { message: `` }
    res.set("Content-Type", "application/json; charset=utf-8")
    let objectReceived = req.body
    let agentRequestingOverwrite = getAgentClaim(req, next)
    if (objectReceived["@id"]) {
        console.log("OVERWRITE")
        let id = objectReceived["@id"].replace(process.env.RERUM_ID_PREFIX, "")
        let originalObject
        try {
            originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
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
            let context = objectReceived["@context"] ? { "@context": objectReceived["@context"] } : {}
            let rerumProp = { "__rerum": originalObject["__rerum"] }
            rerumProp["__rerum"].isOverwritten = new Date(Date.now()).toISOString().replace("Z", "")
            const id = originalObject["_id"]
            //Get rid of them so we can enforce the order
            delete objectReceived["@id"]
            delete objectReceived["@context"]
            delete objectReceived["_id"]
            delete objectReceived["__rerum"]
            let newObject = Object.assign(context, { "@id": originalObject["@id"] }, objectReceived, rerumProp, { "_id": id })
            let result
            try {
                result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": id }, newObject)
            } catch (error) {
                next(createExpressError(error))
            }
            if (result.modifiedCount == 0) {
                //result didn't error out, but it also didn't succeed...
            }
            res.set(utils.configureWebAnnoHeadersFor(newObject))
            res.location(newObject["@id"])
            delete newObject._id
            res.json(newObject)
            return
        }
    }
    else {
        //This is a custom one, the http module will not detect this as a 400 on its own
        err = Object.assign(err, {
            message: `Object in request body must have the property '@id'. ${err.message}`,
            status: 400
        })
    }
    next(createExpressError(err))
}

/**
 * Query the MongoDB for objects containing the key:value pairs provided in the JSON Object in the request body.
 * This will support wildcards and mongo params like {"key":{$exists:true}}
 * The return is always an array, even if 0 or 1 objects in the return.
 * */
exports.query = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    const limit = parseInt(req.query.limit ?? 100)
    const skip = parseInt(req.query.skip ?? 0)
    if (Object.keys(props).length === 0) {
        //Hey now, don't ask for everything...this can happen by accident.  Don't allow it.
        let err = {
            message: "Detected empty JSON object.  You must provide at least one property in the /query request body JSON.",
            status: 400
        }
        next(createExpressError(err))
        return
    }
    try {
        let matches = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find(props).limit(limit).skip(skip).toArray()
        matches =
            matches.map(o => {
                delete o._id
                return o
            })
        res.set(utils.configureLDHeadersFor(matches))
        res.json(matches)
    } catch (error) {
        next(createExpressError(error))
    }
}

/**
 * Query the MongoDB for objects with the _id provided in the request body or request URL
 * Note this specifically checks for _id, the @id pattern is irrelevant.  
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
exports.id = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    try {
        let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
        if (match) {
            res.set(utils.configureWebAnnoHeadersFor(match))
            //Support built in browser caching
            res.set("Cache-Control", "max-age=86400, must-revalidate")
            //Support requests with 'If-Modified_Since' headers
            res.set(utils.configureLastModifiedHeader(match))
            res.location(match["@id"])
            delete match._id
            res.json(match)
            return
        }
        let err = new Error(`No RERUM object with id '${id}'`)
        err.status = 404
        throw err
    } catch (error) {
        next(createExpressError(error))
    }
}

/**
 * Allow for HEAD requests by @id via the RERUM getByID pattern /v1/id/
 * No object is returned, but the Content-Length header is set. 
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
exports.idHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    try {
        let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
        if (match) {
            const size = Buffer.byteLength(JSON.stringify(match))
            res.set("Content-Length", size)
            res.sendStatus(200)
            return
        }
        let err = new Error(`No RERUM object with id '${id}'`)
        err.status = 404
        throw err
    } catch (error) {
        next(createExpressError(error))
    }
}

/**
 * Allow for HEAD requests via the RERUM getByProperties pattern /v1/api/query
 * No objects are returned, but the Content-Length header is set. 
 */
exports.queryHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    try {
        let matches = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find(props).toArray()
        if (matches.length) {
            const size = Buffer.byteLength(JSON.stringify(match))
            res.set("Content-Length", size)
            res.sendStatus(200)
            return
        }
        let err = new Error(`There is no object in the database with id '${id}'.  Check the URL.`)
        err.status = 404
        throw err
    } catch (error) {
        next(createExpressError(error))
    }
}

/**
 * Public facing servlet to gather for all versions downstream from a provided `key object`.
 * @param oid variable assigned by urlrewrite rule for /id in urlrewrite.xml
 * @throws java.lang.Exception
 * @respond JSONArray to the response out for parsing by the client application.
 */
exports.since = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: `Cannot produce a history. There is no object in the database with id '${id}'.  Check the URL.`,
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let descendants = getAllDescendants(all, obj, [])
    descendants =
        descendants.map(o => {
            delete o._id
            return o
        })
    res.set(utils.configureLDHeadersFor(descendants))
    res.json(descendants)
}


/**
 * Public facing servlet action to find all upstream versions of an object.  This is the action the user hits with the API.
 * If this object is `prime`, it will be the only object in the array.
 * @param oid variable assigned by urlrewrite rule for /id in urlrewrite.xml
 * @respond JSONArray to the response out for parsing by the client application.
 * @throws Exception 
 */
exports.history = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: `Cannot produce a history. There is no object in the database with id '${id}'.  Check the URL.`,
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let ancestors = getAllAncestors(all, obj, [])
    ancestors =
        ancestors.map(o => {
            delete o._id
            return o
        })
    res.set(utils.configureLDHeadersFor(ancestors))
    res.json(ancestors)
}

/**
 * Allow for HEAD requests via the RERUM since pattern /v1/since/:_id
 * No objects are returned, but the Content-Length header is set. 
 * */
exports.sinceHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: `Cannot produce a history. There is no object in the database with id '${id}'.  Check the URL.`,
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let descendants = getAllDescendants(all, obj, [])
    if (descendants.length) {
        const size = Buffer.byteLength(JSON.stringify(descendants))
        res.set("Content-Length", size)
        res.sendStatus(200)
        return
    }
    res.set("Content-Length", 0)
    res.sendStatus(200)
}

/**
 * Allow for HEAD requests via the RERUM since pattern /v1/history/:_id
 * No objects are returned, but the Content-Length header is set. 
 * */
exports.historyHeadRequest = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let obj
    try {
        obj = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "_id": id })
    } catch (error) {
        next(createExpressError(error))
        return
    }
    if (null === obj) {
        let err = {
            message: "Cannot produce a history. There is no object in the database with this id. Check the URL.",
            status: 404
        }
        next(createExpressError(err))
        return
    }
    let all = await getAllVersions(obj)
        .catch(error => {
            console.error(error)
            return []
        })
    let ancestors = getAllAncestors(all, obj, [])
    if (ancestors.length) {
        const size = Buffer.byteLength(JSON.stringify(ancestors))
        res.set("Content-Length", size)
        res.sendStatus(200)
        return
    }
    res.set("Content-Length", 0)
    res.sendStatus(200)
}

/**
 * Internal private method to loads all derivative versions from the `root` object. It should always receive a reliable object, not one from the user.
 * Used to resolve the history tree for storing into memory.
 * @param  obj A JSONObject to find all versions of.  If it is root, make sure to prepend it to the result.  If it isn't root, query for root from the ID
 * found in prime using that result as a reliable root object. 
 * @return All versions from the store of the object in the request
 * @throws Exception when a JSONObject with no '__rerum' property is provided.
 */
async function getAllVersions(obj) {
    let ls_versions = null
    let rootObj = null
    let primeID = ""
    if (obj.__rerum) {
        primeID = obj.__rerum.history.prime
    }
    else {
        throw new Error("This object has no history because it has no '__rerum' property.  This will result in an empty array.")
    }
    if (primeID === "root") {
        //The obj passed in is root.  So it is the rootObj we need.
        primeID = obj["@id"]
        rootObj = JSON.parse(JSON.stringify(obj))
    }
    else {
        //The obj passed in knows the ID of root, grab it from Mongo
        rootObj = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "@id": primeID })
    }
    delete rootObj["_id"]
    //All the children of this object will have its @id in __rerum.history.prime
    ls_versions = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find({ "__rerum.history.prime": primeID }).toArray()
    //Get rid of _id, for display
    ls_versions.map(o => delete o["_id"])
    //The root object is a version, prepend it in
    ls_versions.unshift(rootObj)
    return ls_versions
}

/**
 * Internal method to filter ancestors upstream from `key object` until `root`. It should always receive a reliable object, not one from the user.
 * This list WILL NOT contains the keyObj.
 * 
 *  "Get requests can't have body"
 *  In fact in the standard they can (at least nothing says they can't). But lot of servers and firewall implementation suppose they can't 
 *  and drop them so using body in get request is a very bad idea.
 * 
 * @param ls_versions all the versions of the key object on all branches
 * @param keyObj The object from which to start looking for ancestors.  It is not included in the return. 
 * @param discoveredAncestors The array storing the ancestor objects discovered by the recursion.
 * @return All the objects that were deemed ancestors in a JSONArray
 */
function getAllAncestors(ls_versions, keyObj, discoveredAncestors) {
    let previousID = keyObj.__rerum.history.previous //The first previous to look for
    for (let v of ls_versions) {
        if (keyObj.__rerum.history.prime === "root") {
            //Check if we found root when we got the last object out of the list.  If so, we are done.  If keyObj was root, it will be detected here.  Break out. 
            break
        }
        else if (v["@id"] === previousID) {
            //If this object's @id is equal to the previous from the last object we found, its the one we want.  Look to its previous to keep building the ancestors Array.   
            previousID = v.__rerum.history.previous
            if (previousID === "" && v.__rerum.history.prime !== "root") {
                //previous is blank and this object is not the root.  This is gunna trip it up.  
                //@cubap Yikes this is a problem.  This branch on the tree is broken...what should we tell the user?  How should we handle?
                break
            }
            else {
                discoveredAncestors.push(v)
                //Recurse with what you have discovered so far and this object as the new keyObj
                getAllAncestors(ls_versions, v, discoveredAncestors)
                break
            }
        }
    }
    return discoveredAncestors
}

/**
 * Internal method to find all downstream versions of an object.  It should always receive a reliable object, not one from the user.
 * If this object is the last, the return will be an empty JSONArray.  The keyObj WILL NOT be a part of the array.  
 * @param  ls_versions All the given versions, including root, of a provided object.
 * @param  keyObj The provided object
 * @param  discoveredDescendants The array storing the descendants objects discovered by the recursion.
 * @return All the objects that were deemed descendants in a JSONArray
 */
function getAllDescendants(ls_versions, keyObj, discoveredDescendants) {
    let nextIDarr = []
    if (keyObj.__rerum.history.next.length === 0) {
        //essentially, do nothing.  This branch is done.
    }
    else {
        //The provided object has nexts, get them to add them to known descendants then check their descendants.
        nextIDarr = keyObj.__rerum.history.next
    }
    for (let nextID of nextIDarr) {
        for (let v of ls_versions) {
            if (v["@id"] === nextID) { //If it is equal, add it to the known descendants
                //Recurse with what you have discovered so far and this object as the new keyObj
                discoveredDescendants.push(v)
                getAllDescendants(ls_versions, v, discoveredDescendants);
                break
            }
        }
    }
    return discoveredDescendants
}

/**
 * Internal helper method to update the history.previous property of a root object.  This will occur because a new root object can be created
 * by put_update.action on an external object.  It must mark itself as root and contain the original ID for the object in history.previous.
 * This method only receives reliable objects from mongo.
 * 
 * @param newRootObj the RERUM object whose history.previous needs to be updated
 * @param externalObjID the @id of the external object to go into history.previous
 * @return JSONObject of the provided object with the history.previous alteration
 */
async function alterHistoryPrevious(objToUpdate, newPrevID) {
    //We can keep this real short if we trust the objects sent into here.  I think these are private helper functions, and so we can.
    objToUpdate.__rerum.history.previous = newPrevID
    let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": objToUpdate["_id"] }, objToUpdate)
    return result.modifiedCount > 0
}

/**
 * Internal helper method to update the history.next property of an object.  This will occur because updateObject will create a new object from a given object, and that
 * given object will have a new next value of the new object.  Watch out for missing __rerum or malformed __rerum.history
 * 
 * @param idForUpdate the @id of the object whose history.next needs to be updated
 * @param newNextID the @id of the newly created object to be placed in the history.next array.
 * @return Boolean altered true on success, false on fail
 */
async function alterHistoryNext(objToUpdate, newNextID) {
    //We can keep this real short if we trust the objects sent into here.  I think these are private helper functions, and so we can.
    objToUpdate.__rerum.history.next.push(newNextID)
    let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": objToUpdate["_id"] }, objToUpdate)
    return result.modifiedCount > 0
}

/**
 * Internal helper method to handle put_update.action on an external object.  The goal is to make a copy of object as denoted by the PUT request
 * as a RERUM object (creating a new object) then have that new root object reference the @id of the external object in its history.previous. 
 * 
 * @param externalObj the external object as it existed in the PUT request to be saved.
*/
async function updateExternalObject(received) {
    let err = {
        message: "You will get a 201 upon success.  This is not supported yet.  Nothing happened.",
        status: 501
    }
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
        //throw new Error("This object has no history because it has no '__rerum' property.  There is nothing to heal.")
    }
    let objToDeleteisRoot = (prime_id === "root")
    //Update the history.previous of all the next ids in the array of the deleted object
    try {
        for (nextID of next_ids) {
            let objWithUpdate = {}
            const objToUpdate = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "@id": nextID })
            if (null !== objToUpdate) {
                let fixHistory = JSON.parse(JSON.stringify(objToUpdate))
                if (objToDeleteisRoot) {
                    //This means this next object must become root. 
                    //Strictly, all history trees must have num(root) > 0.  
                    if (newTreePrime(fixHistory)) {
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
                    // @cubap @theHabes TODO Yikes this is some kind of error...it is either root or has a previous, this case means neither are true.
                    // cubap: Since this is a __rerum error and it means that the object is already not well-placed in a tree, maybe it shouldn't fail to delete?
                    // theHabes: Are their bad implications on the relevant nodes in the tree that reference this one if we allow it to delete?  Will their account of the history be correct?
                    throw Error("object did not have previous and was not root.")
                }
                //Does this have to be async?
                let verify = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": objToUpdate["_id"] }, fixHistory)
                if (verify.modifiedCount === 0) {
                    //verify didn't error out, but it also didn't succeed...
                    throw Error("Could not update all descendants with their new prime value")
                }
            }
            else {
                throw Error("Could not update all descendants with their new prime value")
            }
        }
        //Here it may be better to resolve the previous_id and check for __rerum...maybe this is a sister RERUM with a different prefix
        if (previous_id.indexOf(process.env.RERUM_PREFIX) > -1) {
            //The object being deleted had a previous that is internal to RERUM.  That previous object next[] must be updated with the deleted object's next[].
            //For external objects, do nothing is the right thing to do here.
            let objWithUpdate2 = {}
            const objToUpdate2 = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "@id": previous_id })
            if (null !== objToUpdate2) {
                let fixHistory2 = JSON.parse(JSON.stringify(objToUpdate2))
                let origNextArray = fixHistory2["__rerum"]["history"]["next"]
                let newNextArray = [...origNextArray]
                //This next should no longer have obj["@id"]
                newNextArray.splice(obj["@id"], 1)
                //This next needs to contain the nexts from the deleted object
                newNextArray = [...newNextArray, ...next_ids]
                fixHistory2["__rerum"]["history"]["next"] = newNextArray //Rewrite the next[] array to fix the history
                //Does this have to be async
                let verify2 = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": objToUpdate2["_id"] }, fixHistory2)
                if (verify2.modifiedCount === 0) {
                    //verify didn't error out, but it also didn't succeed...
                    throw Error("Could not update all ancestors with their altered next value")
                }
            }
            else {
                //The history.previous object could not be found in this RERUM Database.  
                //It has this APIs id pattern, that means we expected to find it.  This is an error.
                //throw new Error("Could not update all descendants with their new prime value")
                throw Error("Could not update all ancestors with their altered next value: cannot find ancestor.")
            }
        }
        else {
            //console.log("The value of history.previous was an external URI or was not present.  Nothing to heal.  URI:"+previous_id);  
        }
    } catch (error) {
        // something threw so the history tree isn't resolved
        console.error(error)
        return false
    }
    //Here it may be better to resolve the previous_id and check for __rerum...maybe this is a sister RERUM with a different prefix
    if (previous_id.indexOf(process.env.RERUM_PREFIX) > -1) {
        //The object being deleted had a previous that is internal to RERUM.  That previous object next[] must be updated with the deleted object's next[].
        //For external objects, do nothing is the right thing to do here.
        let objWithUpdate2 = {}
        const objToUpdate2 = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({ "@id": previous_id })
        if (null !== objToUpdate2) {
            let fixHistory2 = JSON.parse(JSON.stringify(objToUpdate2))
            let origNextArray = fixHistory2["__rerum"]["history"]["next"]
            let newNextArray = [...origNextArray]
            //This next should no longer have obj["@id"]
            newNextArray.splice(obj["@id"], 1)
            //This next needs to contain the nexts from the deleted object
            newNextArray = [...newNextArray, ...next_ids]
            fixHistory2["__rerum"]["history"]["next"] = newNextArray //Rewrite the next[] array to fix the history
            //Does this have to be async
            let verify2 = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": objToUpdate2["_id"] }, fixHistory2)
            if (verify2.modifiedCount === 0) {
                //verify didn't error out, but it also didn't succeed...
                console.error("Could not update all ancestors with their altered next value")
                return false
            }
        }
        else {
            //The history.previous object could not be found in this RERUM Database.  
            //It has this APIs id pattern, that means we expected to find it.  This is an error.
            //throw new Error("Could not update all descendants with their new prime value")
            console.error("Could not update all ancestors with their altered next value: cannot find ancestor.")
            return false
        }
    }
    else {
        //console.log("The value of history.previous was an external URI or was not present.  Nothing to heal.  URI:"+previous_id);  
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
        for (d of descendants) {
            let objWithUpdate = JSON.parse(JSON.stringify(d))
            objWithUpdate["__rerum"]["history"]["prime"] = primeID
            let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({ "_id": d["_id"] }, objWithUpdate)
            if (result.modifiedCount === 0) {
                console.error("Could not update all descendants with their new prime value: newTreePrime failed")
                return false
                //throw new Error("Could not update all descendants with their new prime value: newTreePrime failed")
            }
        }
    }
    else {
        console.error("newTreePrime failed.  Obj did not have '@id'.")
        return false
        //throw new Error("newTreePrime failed.  Obj did not have '@id'.")
    }
    return true
}

/**
 * 
 * @param {Object} update `message` and `status` for creating a custom Error
 * @param {Error} originalError `source` for tracing this Error
 * @returns Error for use in Express.next(err)
 */
function createExpressError(update, originalError = {}) {
    let err = Error("detected error", { cause: originalError })
    if (update.code) {
        /**
         * Detection that createExpressError(error) passed in a mongo client error.
         * IMPORTANT!  If you try to write to 'update' when it comes in as a mongo error...
         * 
            POST /v1/api/create 500
            Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client
         *
         * If you do update.statusMessage or update.statusCode YOU WILL CAUSE THIS ERROR.
         * Make sure you write to err instead.  Object.assign() will have the same result.
         */
        switch (update.code) {
            case 11000:
                //Duplicate _id key error, specific to SLUG support.  This is a Conflict.
                err.statusMessage = `The id provided in the Slug header already exists.  Please use a different Slug.`
                err.statusCode = 409
                break
            default:
                err.statusMessage = "There was a mongo error that prevented this request from completing successfully."
                err.statusCode = 500
        }
    }
    else {
        //Warning!  If 'update' is considered sent, this will cause a 500.  See notes above.
        update.statusMessage = update.message
        update.statusCode = update.status
    }
    Object.assign(err, update)
    return err
}

/**
 * An internal helper for removing a document from the database using a known _id.
 * This is not exposed over the http request and response.
 * Use it internally where necessary.  Ex. end to end Slug test
 */
exports.remove = async function (id) {
    try {
        const result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).deleteOne({ "_id": id })
        if (!result.deletedCount === 1) {
            console.log(result)
            throw Error("Could not remove object")
        }
        return true
    }
    catch (error) {
        console.log(error)
        throw Error("Could not remove object")
    }
}

/**
 * An internal helper for getting the agent from req.user
 * If you do not find an agent, the API does not know this requestor.
 * This means attribution is not possible, regardless of the state of the token.
 * The app is forbidden until registered with RERUM.  Access tokens are encoded with the agent.
 */
function getAgentClaim(req, next) {
    const claimKeys = [process.env.RERUM_AGENT_CLAIM, "http://devstore.rerum.io/v1/agent", "http://store.rerum.io/agent"]
    let agent = ""
    for (claimKey of claimKeys) {
        agent = req.user[claimKey]
        if (agent) {
            return agent
        }
    }
    let err = new Error("Could not get agent from req.user.  Have you registered with RERUM?")
    err.status = 403
    next(createExpressError(err))
}
