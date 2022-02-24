#!/usr/bin/env node

const { MongoClient } = require('mongodb')
var ObjectID = require('mongodb').ObjectID
const client = new MongoClient(process.env.MONGO_CONNECTION_STRING)
client.connect()
console.log("Controller has made a mongo connection...")

// Handle index actions
exports.index = function (req, res) {
    res.json({
        status: "connected",
        message: "Not sure what to do"
    })
}

/**
 * Create a new Linked Open Data object in RERUM v1.
 * Respond RESTfully
 * */
exports.create = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    const id = new ObjectID().toHexString()
    let obj = req.body
    obj["_id"] = id
    obj["@id"] = process.env.RERUM_ID_PREFIX+id
    console.log("Creating an object (no history or __rerum yet)")
    console.log(obj)
    let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(obj)
    res.location(obj["@id"])
    res.status(201)
    res.json(obj)
}

/**
 * Mark an object as deleted in the database.
 * Support /v1/delete/{id}.  Note this is not v1/api/delete, that is not possible (XHR does not support DELETE with body)
 * Note /v1/delete/{blank} does not route here.  It routes to the generic 404.
 * Respond RESTfully
 * */
exports.delete = async function (req, res) {
    let id = req.params["_id"]?req.params["_id"]:""
    res.status(501).send("You will get a 204 upon success.  This is not supported yet.  Nothing happened.")
}

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * Track History
 * Respond RESTfully
 * */
exports.putUpdate = async function (req, res) {
    res.status(501).send("You will get a 204 upon success.  This is not supported yet.  Nothing happened.")
}

/**
 * Update some existing object in MongoDB with the JSON object in the request body.
 * Note that only keys that exist on the object will be respected.  This cannot set or unset keys.  
 * Track History
 * Respond RESTfully
 * */
exports.patchUpdate = async function (req, res) {
    res.status(501).send("You will get a 204 upon success.  This is not supported yet.  Nothing happened.")
}

/**
 * Update some existing object in MongoDB by adding the keys from the JSON object in the request body.
 * Note that if a key on the request object matches a key on the object in MongoDB, that key will be ignored.
 * This cannot change or unset existing keys.
 * Track History
 * Respond RESTfully
 * */
exports.patchSet = async function (req, res) {
    res.status(501).send("You will get a 204 upon success.  This is not supported yet.  Nothing happened.")   
}

/**
 * Update some existing object in MongoDB by removing the keys noted in the JSON object in the request body.
 * Note that if a key on the request object does not match a key on the object in MongoDB, that key will be ignored.
 * This cannot change existing keys or set new keys.
 * Track History
 * Respond RESTfully
 * */
exports.patchUnset = async function (req, res) {
    res.status(501).send("You will get a 204 upon success.  This is not supported yet.  Nothing happened.")
}

/**
 * Replace some existing object in MongoDB with the JSON object in the request body.
 * DO NOT Track History
 * Respond RESTfully
 * */
exports.overwrite = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let obj = req.body
    if(obj.hasOwnProperty("@id")){
        console.log("Overwriting an object (no history or __rerum yet)")
        const query = {"@id":obj["@id"]}
        let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne(query, obj)
        if(result.modifiedCount > 0){
            res.set("Location", obj["@id"])
            res.json(obj)
        }
        else{
            res.sendStatus(304)
        }
    }    
    else{
        //Can I set the 400 status here?
        res.json({"err" : "Object in request body must have the property '@id'."})
    } 
}

/**
 * Query the MongoDB for objects containing the key:value pairs provided in the JSON Object in the request body.
 * This will support wildcards and mongo params like {"key":{$exists:true}}
 * The return is always an array, even if 0 or 1 objects in the return.
 * Track History
 * Respond RESTfully
 * */
exports.query = async function (req, res) {
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
exports.id = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id})
    if(match){
        res.json(match)    
    }
    else{
        res.sendStatus(404)
    }  
}

//Connect to a mongodb via mongodb node driver.
async function mongoConnection(){
  console.log("Awaiting mongo connection...")
  try {
      let mc = new MongoClient(process.env.MONGO_CONNECTION_STRING)
      await mc.connect()
      console.log('Connected successfully to mongodb client')
      //const db = client.db(dbName)
      //const collection = db.collection('documents')
      return mc
  } 
  catch (err) {
    console.log('mongo connect error in app initializer: ')
    console.log(err)
    return err
  } 
}

/**
 * Allow for HEAD requests by @id via the RERUM getByID pattern /v1/id/
 * No object is returned, but the Content-Length header is set. 
 * Note /v1/id/{blank} does not route here.  It routes to the generic 404
 * */
exports.idHeadRequest = async function(req, res){
    res.set("Content-Type", "application/json; charset=utf-8")
    let id = req.params["_id"]
    let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id})
    if(match){
        const size = Buffer.byteLength(JSON.stringify(match))
        res.set("Content-Length", size)
        res.sendStatus(200)    
    }
    else{
        res.sendStatus(404)
    }      
}

/**
 * Allow for HEAD requests via the RERUM getByProperties pattern /v1/api/query
 * No objects are returned, but the Content-Length header is set. 
 * */
exports.queryHeadRequest = async function(req, res){
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
        res.sendStatus(204)    
    }
}
