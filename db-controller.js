#!/usr/bin/env node

var mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
console.log("Controller is making a mongo connection...");
const client = new MongoClient(process.env.ATLAS_CONNECTION_STRING2);
client.connect();

// Import contact model
Model = require('./db-object-model.js');

// Handle index actions
exports.index = function (req, res) {
    console.log("index controller")
    res.json({
        status: "connected",
        message: "Not sure what to do"
    });
};

// Create object passed in the body
// TODO only registered apps should be able to do this.  It needs to generate the __rerum property.
exports.create = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "*");
    res.set("Access-Control-Expose-Headers", "*");
    res.set("Access-Control-Allow-Methods", "*");
    try{
        const id = new mongoose.Types.ObjectId().toString();
        let obj = req.body;
        obj["_id"] = id;
        obj["@id"] = "https://rerum-server-nodejs.herokuapp.com/v1/id/"+id;
        console.log("Creating an object (no history or __rerum yet)");
        console.log(obj);
        let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(obj);
        res.set("Location", obj["@id"])
        res.json(obj);
    }
    catch(err){
        console.error("Could not perform insertOne, see error below");
        console.log(err)
        res.json({"err":err});
    }
};

// Create object passed in the body
// TODO only registered apps should be able to do this.  It should alter history.
// Note this is the same thing as an /overwrite without history when you don't care about __rerum.generatedBy.
exports.putUpdate = async function (req, res) {
    
};

// Overwrite object passed in the body with replaceOne 
// TODO only registered apps, and only if the requestor is of the agent __rerum.generatedBy for the object being overwritten.
exports.overwrite = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "*");
    res.set("Access-Control-Expose-Headers", "*");
    res.set("Access-Control-Allow-Methods", "*");
    try{
        let obj = req.body;
        if(obj.hasOwnProperty("@id")){
            console.log("Overwriting an object (no history or __rerum yet)");
            const query = {"@id":obj["@id"]};
            let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne(query, obj);
            if(result.modifiedCount > 0){
                res.set("Location", obj["@id"])
                res.json(obj);
            }
            else{
                res.sendStatus(304);
            }
        }    
        else{
            //Can I set the 400 status here?
            res.json({"err" : "Object in request body must have the property '@id'."})
        } 
    }
    catch(err){
        console.error("Could not perform overwrite, see error below");
        console.log(err)
        res.json({"err":err});
    }
};

// Handle find by property object matching
exports.query = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "*");
    res.set("Access-Control-Expose-Headers", "*");
    res.set("Access-Control-Allow-Methods", "*");
    try{
        let props = req.body
        console.log("Looking matches against props...");
        console.log(props);
        let matches = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).find(props).toArray();
        console.log(matches);
        res.json(matches);
    }
    catch(err){
        console.error("Could not perform query, see error below");
        console.log(err)
        res.json([]);
    }
};

// Just makes a very simple object based on a simple model.  Happens on the fly.
exports.makeNew = function (req, res) {
    var modelObj = new Model();
    const id = new mongoose.Types.ObjectId();
    const RERUM_PREFIX = "https://rerum-server-nodejs.herokuapp.com/v1/id/";
    modelObj["_id"] = id;
    modelObj["@id"] = RERUM_PREFIX+id;
    modelObj.name = "Hello "+Date.now();
    // save the contact and check for errors
    //Here, we can hand in an object that is not formed from the model
    console.log("Use Model.create to put the following object into the db");
    console.log(modelObj);
    Model.create(modelObj, function (err, data) {
        if (err){
            console.log("Error with Model.create");
            console.error(err);
            res.send(err);
        }
        else{
            console.log("Success with Model.create");
            res.json(data); //hmm not sure this is right, maybe just do modelObj?
        }
    });
};


// Handle find by property object matching
exports.getByProps = function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "*");
    res.set("Access-Control-Expose-Headers", "*");
    res.set("Access-Control-Allow-Methods", "*");
    let prop = req.body
    console.log("Props request object");
    console.log(prop);
    Model.find(prop, function (err, obj) {
        if (err){
            console.log("Model.findOne did not work as expected")
            console.error(err)
            res.send(err);
        }
        else{
            console.log("View found object");
            console.log(obj)
            res.json(obj);
        }
    });
};

//  Find by _id and return the match
exports.id = async function (req, res) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "*");
    res.set("Access-Control-Expose-Headers", "*");
    res.set("Access-Control-Allow-Methods", "*");
    let id = req.params["_id"];
    let match = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).findOne({"_id" : id});
    if(match){
        res.json(match);    
    }
    else{
        res.sendStatus(404);
    }
    
};

/*
// Handle find by _id with Model
exports.id = function (req, res) {
    let id =  req.params["_id"]
    Model.findById(id, function (err, obj) {
        if (err){
            console.error("")
            res.send(err);
        }
        else{
            console.log("View found object");
            console.log(obj)
            res.json(obj);
        }
    });
};
*/
