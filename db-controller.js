#!/usr/bin/env node

var mongoose = require('mongoose');
// Import collection connection from app.s
//var mongodb =  require('./db-collection-connection.js');
//var mongodbCollection =  MongoClient.db(process.env.MONGODBNAME).collection(process.env.MONGODBCOLLECTION);
//var mongodbCollection = mongoConnection().then(conn => conn.db(process.env.MONGODBNAME)).then(db => db.collection(process.env.MONGODBCOLLECTION))
// ??
/*
const { MongoClient } = require('mongodb');
var mongodbCollection = mongoConnection().then(conn => conn.db(process.env.MONGODBNAME)).then(db => db.collection(process.env.MONGODBCOLLECTION))
*/
//const MongoClient = require('mongodb').MongoClient;
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.ATLAS_CONNECTION_STRING2);


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
    const id = new mongoose.Types.ObjectId();
    let obj = req.body
    console.log("No connection for creation.  Just handing you the object back");
    res.json(obj);

};

// Handle find by property object matching
exports.query = async function (req, res) {
    try{
        //Return the array of matches 
        let conn = await client.connect();
        let props = req.body
        console.log("Props request object");
        console.log(props);
        console.log("DBNAME: "+process.env.MONGODBNAME)
        console.log("COLLECTIONNAME: "+process.env.MONGODBCOLLECTION)
        let db = conn.db(process.env.MONGODBNAME);
        let collection = db.collection(process.env.MONGODBCOLLECTION)
        let matches = await collection.find(props);
        return matches;
    }
    catch(err){
        console.error("Could not perform query, see error below");
        console.log(err)
        return []
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

//Connect to a mongodb via mongodb node driver.
async function mongoConnection(){
  console.log("Awaiting mongo connection...")
  try {
      const client = new MongoClient(process.env.ATLAS_CONNECTION_STRING2);
      let clientConnection = await client.connect();
      console.log('Connected successfully to mongodb client');
      //const db = client.db(dbName);
      //const collection = db.collection('documents');
      return clientConnection;
  } 
  catch (err) {
    console.log('mongo connect error in app initializer: ');
    return err;
  } 
}
