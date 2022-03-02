#!/usr/bin/env node

/**
 * This module is used to define the routes of the various HITTP request that come to the app.
 * Since this app functions as an API layer, it controls RESTful flows.  Make sure to send a RESTful
 * status code and response message. 
 * 
 * It is used as middleware and so has access to the http module request and response objects, as well as next()
 * 
 * @author thehabes 
 */

const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')
const auth = require('../auth')

/*
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
*/

// Set default API response
router.get('/', function (req, res) {
    res.json({
        message: 'Welcome to v1 in nodeJS!'
    })
})

/**
 * Support GET requests like v1/id/{object id}  
*/
router.route('/id/:_id')
    .get(controller.id)
    .post((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .patch((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .head(controller.idHeadRequest)
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })

/**
 * Support POST requests with JSON bodies used for passing queries though to the database.
*/
router.route('/api/query')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for requesting objects with matching properties.  Please use POST.'
        res.status(405)
        next()
    })
    .post(controller.query)
    .put((req, res) => {
        res.statusMessage = 'Improper request method for requesting objects with matching properties.  Please use POST.'
        res.status(405)
        next()
    })
    .patch((req, res) => {
        res.statusMessage = 'Improper request method for requesting objects with matching properties.  Please use POST.'
        res.status(405)
        next()
    })
    //Do we want to support this? Technically HEAD is only for something that could be a GET request.  
    //.head(controller.queryHeadRequest)
    .head((req, res) => {
        res.statusMessage = 'Improper request method for requesting objects with matching properties.  Please use POST.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for requesting objects with matching properties.  Please use POST.'
        res.status(405)
        next()
    })

/**
 * Support POST requests with JSON bodies used for establishing new objects in the MongoDB.
*/
router.route('/api/create')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .post(auth.checkJwt,controller.create)
    .put((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .patch((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .head((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next()
    })

/**
 * Support POST requests with JSON bodies used for replacing some existing object in MongoDB.
 * This is the same as a PUT update, except it DOES NOT TRACK HISTORY 
*/
router.route('/api/overwrite')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for overwriting, please use PUT to overwrite this object.'
        res.status(405)
        next()
    })
    .post((req, res) => {
        res.statusMessage = 'Improper request method for overwriting, please use PUT to overwrite this object.'
        res.status(405)
        next()
    })
    .put(auth.checkJwt,controller.overwrite)
    .patch((req, res) => {
        res.statusMessage = 'Improper request method for overwriting, please use PUT to overwrite this object.'
        res.status(405)
        next()
    })
    .head((req, res) => {
        res.statusMessage = 'Improper request method for overwriting, please use PUT to overwrite this object.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for overwriting, please use PUT to overwrite this object.'
        res.status(405)
        next()
    })
    

/**
 * Support POST requests with JSON bodies used for replacing some existing object in MongoDB.
 * Note that this will track history. 
*/ 
router.route('/api/update')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PUT to update this object.'
        res.status(405)
        next()
    })
    .post((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PUT to update this object.'
        res.status(405)
        next()
    })
    .put(auth.checkJwt,controller.putUpdate)
    .patch((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PUT to update this object.'
        res.status(405)
        next()
    })
    .head((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PUT to update this object.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PUT to update this object.'
        res.status(405)
        next()
    })

/**
 * Support PATCH requests with JSON bodies used for replacing some existing keys in some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
 * 
 * If there is nothing to PATCH, return a 200 
*/ 
router.route('/api/patch')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
        res.status(405)
        next()
    })
    .post((req, res) => {
        if(rest.checkPatchOverrideSupport()){
            controller.patchUpdate(req, resp)
        }
        else{
            res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
            res.status(405)
            next()    
        }
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
        res.status(405)
        next()
    })
    .patch(auth.checkJwt,controller.patchUpdate)
    .head((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
        res.status(405)
        next()
    })

/**
 * Support PATCH requests with JSON bodies used for creating new keys in some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are already on the existing object are ignored.   
 * 
 * If there is nothing to PATCH, return a 200 
*/ 
router.route('/api/set')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()
    })
    .post((req, res) => {
        if(rest.checkPatchOverrideSupport()){
            controller.patchSet(req, resp)
        }
        else{
            res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
            res.status(405)
            next()    
        }
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()    })
    .patch(auth.checkJwt,controller.patchSet)
    .head((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()
    })

/**
 * Support PATCH requests with JSON bodies like 'key:null' used for removing existing keys from some existing object in MongoDB.
 * Note that this will track history.
 * Note that keys in the body of this request that are not on the existing object are ignored.  
 * 
 * If there is nothing to PATCH, return a 200 
*/ 
router.route('/api/unset')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
        res.status(405)
        next()
    })
    .post((req, res) => {
        if(rest.checkPatchOverrideSupport()){
            controller.patchUnset(req, resp)
        }
        else{
            res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
            res.status(405)
            next()    
        }
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
        res.status(405)
        next()
    })
    .patch(auth.checkJwt,controller.patchUnset)
    .head((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
        res.status(405)
        next()
    })
    .delete((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to remove keys from this object.'
        res.status(405)
        next()
    })

/**
 * DELETE cannot have body.  It is possible to call /delete/ without an id, which will 400.
*/ 
router.route('/api/delete/:_id?')
    .get((req, res) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405)
        next()
    })
    .post((req, res) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405)
        next()
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405)
        next()
    })
    .patch((req, res) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405)
        next()
    })
    .head((req, res) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405)
        next()
    })
    .delete(auth.checkJwt,controller.delete)  


/**
 * Use this to catch 404s because of invalid /api/ paths and pass them to the error handler in app.js
 * 
 * Note while we have 501s, they will fall here.  Don't let them trick you.
 * Detect them and send them out, don't hand up to the 404 catcher in app.js
 */
router.use(function(req, res, next) {
    if(res.statusCode === 501){
        //We can remove this once we implement the functions, for now we have to catch it here.
        let msg = res.statusMessage ? res.statusMessage : "This is not yet implemented"
        res.status(501).send(msg).end()
    }
    else{
        //A 404 to pass along to our 404 handler in app.js
        next()
    }
})

// Export API routes
module.exports = router
