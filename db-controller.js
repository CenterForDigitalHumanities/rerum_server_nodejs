#!/usr/bin/env node

var mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
// Import collection connection from app.s
//var mongodb =  require('./db-collection-connection.js');
//var mongodbCollection =  MongoClient.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION);

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

//  Create object passed in the body
exports.create = function (req, res) {
    try{
        const id = new mongoose.Types.ObjectId();
        let obj = req.body;
        obj["_id"] = id;
        obj["@id"] = "https://rerum-server-nodejs.herokuapp.com/v1/id/"+id;
        console.log("Creating an object (no history or __rerum yet)");
        console.log(obj);
        let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).insertOne(obj);
        res.json(result);
    }
    catch(err){
        console.error("Could not perform insertOne, see error below");
        console.log(err)
        res.json({"err":err});
    }
};

//  Update object passed in the body
exports.overwrite = function (req, res) {
    try{
        let obj = req.body;
        if(obj.hasProperty("@id")){
            console.log("Overwriting an object (no history or __rerum yet)");
            const query = {"@id":obj["@id"]};
            let result = await client.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION).replaceOne(query, obj);
            res.json(result);
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

// Handle find by _id
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
