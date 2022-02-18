#!/usr/bin/env node
const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
//const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')


const createRoute = require("./create.js")
const putUpdateRoute = require("./putUpdate.js")
const overwriteRoute = require("./overwrite.js")
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

/**
 * Support GET requests like v1/id/{object id}  
 * RESTfully handle bad methods and request bodies.  
 * RESTfully respond in 500 scenarios.
*/
router.route('/id/:_id')
    .get(controller.id)
    .post((req, res) => {
        res.status(405).send('Improper request method for reading, please use GET or request for headers with HEAD.')
    })
    .put((req, res) => {
        res.status(405).send('Improper request method for reading, please use GET or request for headers with HEAD.')
    })
    .patch((req, res) => {
        res.status(405).send('Improper request method for reading, please use GET or request for headers with HEAD.')
    })
    .options(rest.optionsRequest)
    .head(controller.idHeadRequest)

/**
 * Support POST requests with JSON bodies used for passing queries though to the database.
 * RESTfully handle bad methods and request bodies.  
 * RESTfully respond in 500 scenarios. 
*/
router.route('/api/query')
    .get((req, res) => {
        res.status(405).send('Improper request method for requesting objects with matching properties.  Please use POST.')
    })
    .post(controller.query)
    .put((req, res) => {
        res.status(405).send('Improper request method for requesting objects with matching properties.  Please use POST.')
    })
    .patch((req, res) => {
        res.status(405).send('Improper request method for requesting objects with matching properties.  Please use POST.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for requesting objects with matching properties.  Please use POST.')
    })
    //Do we want to support this? Technically HEAD is only for something that could be a GET request.  
    //.head(controller.queryHeadRequest)

/**
 * Support POST requests with JSON bodies used for establishing new objects in the MongoDB.
 * RESTfully handle bad methods and request bodies.  
 * RESTfully respond in 500 scenarios. 
*/
router.route('/api/create')
    .get((req, res) => {
        res.status(405).send('Improper request method for creating, please use POST.')
    })
    .post(controller.create)
    .put((req, res) => {
        res.status(405).send('Improper request method for creating, please use POST.')
    })
    .patch((req, res) => {
        res.status(405).send('Improper request method for creating, please use POST.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for creating, please use POST.')
    })


/**
 * Support POST requests with JSON bodies used for replacing some existing object in MongoDB.
 * This is the same as a PUT update, except it DOES NOT TRACK HISTORY 
*/
router.route('/api/overwrite')
    .get((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    .post((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    .put(controller.overwrite)
    .patch((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    

/**
 * Support POST requests with JSON bodies used for replacing some existing object in MongoDB.
 * Note that this will track history. 
*/ 
router.route('/api/update')
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    .post((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    .put(controller.putUpdate)
    .patch((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    

/**
 * Support PATCH requests with JSON bodies used for replacing some existing keys in some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
*/ 
router.route('/api/patch')
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    })
    .post((req, res) => {
        if(rest.checkPatchOverrideSupport()){
            controller.patchUpdate(req, resp)
        }
        else{
            res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')    
        }
    })
    .put((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    })
    .patch(controller.patchSet)
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    })
    

/**
 * Support PATCH requests with JSON bodies used for creating new keys in some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are already on the existing object are ignored.   
*/ 
router.route('/api/set')
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to add new keys object.')
    })
    .post(rest.checkPatchOverrideSupport)
    .put((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to add new keys object.')
    })
    .patch(controller.patchSet)
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to add new keys object.')
    })
    

/**
 * Support PATCH requests with JSON bodies like 'key:null' used for removing existing keys from some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
*/ 
router.route('/api/unset')
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to remove keys from this object.')
    })
    .post(rest.checkPatchOverrideSupport)
    .put((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to remove keys from this object.')
    })
    .patch(controller.patchUnset)
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to remove keys from this object.')
    })

/**
 * Support PATCH requests with JSON bodies like 'key:null' used for removing existing keys from some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
*/ 
router.route('/api/delete')
    .get((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .post((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .put((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .patch((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .delete(controller.delete)    
   
// Export API routes
module.exports = router
