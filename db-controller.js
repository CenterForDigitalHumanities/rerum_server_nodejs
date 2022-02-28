#!/usr/bin/env node

/**
 * This module is used to connect to a mongodb instance and perform the necessary unit actions
 * to complete an API action.  This is connected to a RESTful API.  Known database misteps, like NOT FOUND,
 * should pass a RESTful message downstream.
 * 
 * It is used as middleware and so has access to the http module request and response objects, as well as next() 
 * 
 * @author thehabes 
 */

const { MongoClient } = require('mongodb')
var ObjectID = require('mongodb').ObjectID
const _ = require("lodash")
const client = new MongoClient(process.env.MONGO_CONNECTION_STRING)
client.connect()
console.log("Controller has made a mongo connection...")

// Handle index actions
exports.index = function (req, res, next) {
    res.json({
        status: "connected",
        message: "Not sure what to do"
    })
}

/**
 * Create a new Linked Open Data object in RERUM v1.
 * Respond RESTfully
 * */
exports.create = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const id = new ObjectID().toHexString()
    //A token came in with this request.  We need the agent from it.  
    let generatorAgent = "http://dev.rerum.io/agent/CANNOTBESTOPPED"
    let newObject = utils.configureRerumOptions(generatorAgent, req.body, false, false)
    newObject["_id"] = id
    newObject["@id"] = process.env.RERUM_ID_PREFIX+id
    console.log("Creating an object (no history or __rerum yet)")
    console.log(newObject)
    let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
    res.location(newObject["@id"])
    res.status(201)
    res.json(newObject)
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
    let id = req.params["_id"]?req.params["_id"]:""
    res.status(501)
    res.statusMessage = "You will get a 204 upon success.  This is not supported yet.  Nothing happened."
    next()
}

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * Track History
 * Respond RESTfully
 * */
exports.putUpdate = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let received = JSON.parse(JSON.stringify(req.body))
    //A token came in with this request.  We need the agent from it.  
    let generatorAgent = "http://dev.rerum.io/agent/CANNOTBESTOPPED"
    if(received.hasOwnProperty("@id")){
        let updateHistoryNextID = received["@id"]
        let id = received.replace(process.env.RERUM_PREFIX, "")
        //Do we want to look up by _id or @id?
        const originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id})
        let original_copy = JSON.parse(JSON.stringify(originalObject))
        const alreadyDeleted = false //checkIfDeleted(originalObject) //WRITE ME
        const isReleased = false //checkIfReleased(originalObject) //WRITE ME
        if(undefined !== originalObject){{
            //This object is not in RERUM, they want to import it.  Do that automatically.  
            //updateExternalObject(received)
            res.statusMessage = "This object is not from RERUM and will need imported.  This is not supported yet."
            res.status(501)
            next()
        }
        else if(_.isEqual(received, originalObject)){
            res.statusMessage("Nothing to update")
            res.status(304)
            next()
        }
        /*
        else if(alreadyDeleted){
            res.statusMessage("The object you are trying to update is deleted.")
            res.status(403)
            next()
        }
        else if(isReleased){
            res.statusMessage("The object you are trying to update is released.  Fork to make changes.")
            res.status(403)
            next()
        }
        */
        else{
            console.log("Put Updating an object (no history or __rerum yet)")
            //The agent from the token of this request will be the generator for this new object
            let newObject = utils.configureRerumOptions(generatorAgent, originalObject, true, false)
            const newObjID = new ObjectID().toHexString()
            newObject["_id"] = newObjID
            newObject["@id"] = process.env.RERUM_ID_PREFIX+newObjID
            let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(newObject)
            if(alterHistoryNext(originalObject, newObject["@id"])){
                //Success, the original object has been updated.
                res.location(newObject["@id"])
                res.status(200)
                res.json(newObject)
            }
            else{
                res.statusMessage = "Unable to alter the history next of the originating object.  The history tree may be broken. See "+originalObject["@id"]
                res.status(500)
                next()
            }
        }
    }
    else{
        //The http module will not detect this as a 400 on its own
        res.statusMessage = "Object in request body must have the property '@id'."
        res.status(400)
        next()
    } 
}

/**
 * Update some existing object in MongoDB with the JSON object in the request body.
 * Note that only keys that exist on the object will be respected.  This cannot set or unset keys.  
 * If there is nothing to PATCH, return a 200 with the object in the response body. 
 * Track History
 * Respond RESTfully
 * */
exports.patchUpdate = async function (req, res, next) {
    res.statusMessage = "You will get a 200 upon success.  This is not supported yet.  Nothing happened."
    res.status(501)
    next()
}

/**
 * Update some existing object in MongoDB by adding the keys from the JSON object in the request body.
 * Note that if a key on the request object matches a key on the object in MongoDB, that key will be ignored.
 * This cannot change or unset existing keys.
 * Track History
 * Respond RESTfully
 * */
exports.patchSet = async function (req, res, next) {
    res.statusMessage = "You will get a 200 upon success.  This is not supported yet.  Nothing happened."
    res.status(501)
    next()
}

/**
 * Update some existing object in MongoDB by removing the keys noted in the JSON object in the request body.
 * Note that if a key on the request object does not match a key on the object in MongoDB, that key will be ignored.
 * This cannot change existing keys or set new keys.
 * Track History
 * Respond RESTfully
 * */
exports.patchUnset = async function (req, res, next) {
    res.statusMessage = "You will get a 200 upon success.  This is not supported yet.  Nothing happened."
    res.status(501)
    next()
}

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * DO NOT Track History
 * Respond RESTfully
 * */
exports.overwrite = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let received = req.body
    if(received.hasOwnProperty("@id")){
        console.log("Overwriting an object (no history or __rerum yet)")
        let id = received["@id"].replace(process.env.RERUM_PREFIX, "")
        //Do we want to look up by _id or @id?
        const originalObject = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id})
        if(undefined === originalObject){
            res.statusMessage = "No object with this id could be found in RERUM.  Cannot overwrite."
            res.status(404)
            next()
        }
        else if(_.isEqual(received, originalObject)){
            res.statusMessage("Nothing to overwrite")
            res.status(304)
            next()
        }
        else{
            let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({"_id" : id}, received)
            res.set("Location", obj["@id"])
            res.json(received)    
        }

    }    
    else{
        //This is a custom one, the http module will not detect this as a 400 on its own
        res.statusMessage = "Object in request body must have the property '@id'."
        res.status(400)
        next()
    } 
}

/**
 * Query the MongoDB for objects containing the key:value pairs provided in the JSON Object in the request body.
 * This will support wildcards and mongo params like {"key":{$exists:true}}
 * The return is always an array, even if 0 or 1 objects in the return.
 * Track History
 * Respond RESTfully
 * */
exports.query = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    console.log("Looking matches against props...")
    console.log(props)
    let matches = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find(props).toArray()
    console.log(matches)
    res.json(matches)
}

/**
 * Query the MongoDB for objects with the _id provided in the request body or request URL
 * Note this specifically checks for _id, the @id pattern is irrelevant.  
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * Track History
 * Respond RESTfully
 * */
exports.id = async function (req, res, next) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]?req.params["_id"]:""
    let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id})
    if(match){
        res.json(match)    
    }
    else{
        res.statusMessage = "There is no object in the database with this id.  Check the URL."
        res.status(404)
        next()
    }  
}

/**
 * Allow for HEAD requests by @id via the RERUM getByID pattern /v1/id/
 * No object is returned, but the Content-Length header is set. 
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
exports.idHeadRequest = async function(req, res, next){
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id})
    if(match){
        const size = Buffer.byteLength(JSON.stringify(match))
        res.set("Content-Length", size)
        res.sendStatus(200)    
    }
    else{
        res.statusMessage = "There is no object in the database with this id.  Check the URL."
        res.status(404)
        next()
    }      
}

/**
 * Allow for HEAD requests via the RERUM getByProperties pattern /v1/api/query
 * No objects are returned, but the Content-Length header is set. 
 * */
exports.queryHeadRequest = async function(req, res, next){
    res.set("Content-Type", "application/json; charset=utf-8")
    let props = req.body
    let matches = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find(props).toArray()
    if(matches.length){
        const size = Buffer.byteLength(JSON.stringify(match))
        res.set("Content-Length", size)
        res.sendStatus(200)    
    }
    else{
        res.set("Content-Length", 0)
        res.sendStatus(200)    
    }
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
exports.alterHistoryPrevious = async function(objToUpdate, newPrevID){
    //We can keep this real short if we trust the objects sent into here.  I think these are private helper functions, and so we can.
    objToUpdate.["__rerum"].history.previous = newPrevID
    let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({"_id":objToUpdate["_id"]}, objToUpdate)
    return true
}

/**
 * Internal helper method to update the history.next property of an object.  This will occur because updateObject will create a new object from a given object, and that
 * given object will have a new next value of the new object.  Watch out for missing __rerum or malformed __rerum.history
 * 
 * @param idForUpdate the @id of the object whose history.next needs to be updated
 * @param newNextID the @id of the newly created object to be placed in the history.next array.
 * @return Boolean altered true on success, false on fail
 */
exports.alterHistoryNext = async function(objToUpdate, newNextID){
    //We can keep this real short if we trust the objects sent into here.  I think these are private helper functions, and so we can.
    objToUpdate["__rerum"].history.next.push(newNextID)
    let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne({"_id":objToUpdate["_id"]}, objToUpdate)
    return true
}
