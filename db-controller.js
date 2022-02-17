#!/usr/bin/env node

const { MongoClient } = require('mongodb')
var ObjectID = require('mongodb').ObjectID
const client = new MongoClient(process.env.MONGO_CONNECTION_STRING);
client.connect();
console.log("Controller is made a mongo connection...")
//var client = mongoConnection()

// Handle index actions
exports.index = function (req, res) {
    res.json({
        status: "connected",
        message: "Not sure what to do"
    })
}

// Create object passed in the body
// TODO only registered apps should be able to do this.  It needs to generate the __rerum property.
exports.create = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Headers", "*")
    res.set("Access-Control-Expose-Headers", "*")
    res.set("Access-Control-Allow-Methods", "*")
    try{
        const id = new ObjectID().toHexString()
        let obj = req.body
        obj["_id"] = id
        obj["@id"] = "https://storedev.rerum.io/v1/id/"+id
        console.log("Creating an object (no history or __rerum yet)")
        console.log(obj)
        let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(obj)
        res.set("Location", obj["@id"])
        res.json(obj)
    }
    catch(err){
        console.error("Could not perform insertOne, see error below")
        console.log(err)
        res.json({"err":err})
    }
}

// Create object passed in the body
// TODO only registered apps should be able to do this.  It should alter history.
// Note this is the same thing as an /overwrite without history when you don't care about __rerum.generatedBy.
exports.putUpdate = async function (req, res) {
    
}

// Overwrite object passed in the body with replaceOne 
// TODO only registered apps, and only if the requestor is of the agent __rerum.generatedBy for the object being overwritten.
exports.overwrite = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Headers", "*")
    res.set("Access-Control-Expose-Headers", "*")
    res.set("Access-Control-Allow-Methods", "*")
    try{
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
    catch(err){
        console.error("Could not perform overwrite, see error below")
        console.log(err)
        res.json({"err":err})
    }
}

// Handle find by property object matching
exports.query = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Headers", "*")
    res.set("Access-Control-Expose-Headers", "*")
    res.set("Access-Control-Allow-Methods", "*")
    try{
        let props = req.body
        console.log("Looking matches against props...")
        console.log(props)
        let matches = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find(props).toArray()
        console.log(matches)
        res.json(matches)
    }
    catch(err){
        console.error("Could not perform query, see error below")
        console.log(err)
        res.json([])
    }
}

//  Find by _id and return the match
exports.id = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8")
    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Headers", "*")
    res.set("Access-Control-Expose-Headers", "*")
    res.set("Access-Control-Allow-Methods", "*")
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
