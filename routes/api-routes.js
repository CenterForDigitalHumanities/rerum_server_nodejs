#!/usr/bin/env node
const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')
// https://stackoverflow.com/a/68151763/1413302 body-parser is already in express.json() now.  Confirm this, and remove bodyParser if so.
const bodyParser = require('body-parser')
const jsonParser = bodyParser.json()

const createRoute = require("./create.js")
const putUpdateRoute = require("./putUpdate.js")
const patchUpdateRoute = require("./patchUpdate.js")
const patchSetRoute = require("./patchSet.js")
const patchUnsetRoute = require("./patchUnset.js")
const getByIdRoute = require("./id.js")
const queryRoute = require("./query.js")
const deleteRoute = require("./delete.js")
const auxRoute = "TODO"

// Set default API response
router.get('/', function (req, res) {
    res.json({
        message: 'Welcome to v1 in nodeJS!'
    })
})

// api/test to just return some JSON, no DB interactions
router.route('/api/test')
    .get(controller.index)
    .post(controller.index)
    .put(controller.index)
    .patch(controller.index)
    .options(rest.optionsRequest)
    .head(controller.index)

/**
 * Support GET requests like v1/id/{object id}  
 * RESTfully handle bad methods and request bodies.  
 * RESTfully respond in 500 scenarios. 
*/
router.all('/id/:_id', getByIdRoute)

/**
 * Support POST requests with JSON bodies used for passing queries though to the database.
 * RESTfully handle bad methods and request bodies.  
 * RESTfully respond in 500 scenarios. 
*/
router.all('/api/query', queryRoute)
   

/**
 * Support POST requests with JSON bodies used for establishing new objects in the MongoDB.
 * RESTfully handle bad methods and request bodies.  
 * RESTfully respond in 500 scenarios. 
*/
router.all('/api/create', createRoute)


/**
 * Support POST requests with JSON bodies used for replacing some existing object in MongoDB.
 * This is the same as a PUT update, except it DOES NOT TRACK HISTORY 
*/
router.all('/api/overwrite', overwriteRoute)
    

/**
 * Support POST requests with JSON bodies used for replacing some existing object in MongoDB.
 * Note that this will track history. 
*/ 
router.all('/api/update', putUpdateRoute)
    

/**
 * Support PATCH requests with JSON bodies used for replacing some existing keys in some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
*/ 
router.all('/api/patch', patchUpdateRoute)
    

/**
 * Support PATCH requests with JSON bodies used for creating new keys in some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are already on the existing object are ignored.   
*/ 
router.all('/api/set', patchSetRoute)
    

/**
 * Support PATCH requests with JSON bodies like 'key:null' used for removing existing keys from some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
*/ 
router.all('/api/unset', patchUnsetRoute)
    
   
// Export API routes
module.exports = router
