#!/usr/bin/env node

var mongoose = require('mongoose');
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


// Handle save new object
exports.save = function (req, res) {
    let modelObj = new Model();
    const id = req.body["_id"] ? req.body["_id"] : new mongoose.Types.ObjectId();
    const RERUM_PREFIX = "http://devstore.rerum.io/v1/id/"
    modelObj["_id"] = id
    modelObj["@id"] = req.body["@id"] ? req.body["@id"] : RERUM_PREFIX+new mongoose.Types.ObjectId();
    modelObj.name = "Hello "+Date.now();
    // save the contact and check for errors
    //save() means the object being saved HAS TO BE AN INSTANCE OF THE MODEL.  
    console.log("Use Model.save to put the following object into the db");
    console.log(modelObj);
    modelObj.save(function (err) {
        if (err){
            console.log("Error with Model.save");
            console.error(err);
            res.send(err);
        }
        else{
            console.log("Success with Model.save");
            res.json(modelObj);
        }
    });
};


// Handle create new object
exports.create = function (req, res) {
    var modelObj = new Model();
    const id = new mongoose.Types.ObjectId();
    const RERUM_PREFIX = "http://devstore.rerum.io/v1/id/";
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
exports.getByProp = function (req, res) {
    //let prop = req.readPropFromBody()
    let id =  req.params["_id"]
    const RERUM_PREFIX = "http://devstore.rerum.io/v1/id/";
    let prop = {"@id":RERUM_PREFIX+id}
    console.log("view controller")
    Model.findOne(prop, function (err, obj) {
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
exports.getByID = function (req, res) {
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
