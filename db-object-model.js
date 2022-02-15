#!/usr/bin/env node
var mongoose = require('mongoose');
// Setup schema
const schema = new mongoose.Schema({ "_id": mongoose.ObjectId, "@id":String }, {"collection":"alpha"});
const Model = module.exports = mongoose.model('simple', schema);

//Get all instances of this model.  Provide callback and limit if desired.
module.exports.get = function (callback, limit) {
    console.log("get : db-object-model.js");
    Model.find(callback).limit(limit);
}