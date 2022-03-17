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
const staticRouter = require('./static.js')
router.use(staticRouter)

// Support GET requests like v1/id/{object id}  
const idRouter = require('./id.js')
router.use('/id',idRouter)

// Support POST requests with JSON bodies used for passing queries though to the database.
const queryRouter = require('./query.js')
router.use('api/query', queryRouter)

// Support POST requests with JSON bodies used for establishing new objects.
const createRouter = require('./create.js')
router.use('api/create', createRouter)

// Support POST requests with JSON bodies used for replacing some existing object.
const overwriteRouter = require('./overwrite.js')
router.use('api/overwrite', overwriteRouter)

// Support PUT requests with JSON bodies used for versioning an existing object through replacement.
const updateRouter = require('./putUpdate.js')
router.use('api/update', updateRouter)

// Support PATCH requests with JSON bodies used for versioning an existing object through key/value setting.
const patchRouter = require('./patchUpdate.js')
router.use('api/patch', patchRouter)

// Set default API response
router.get('/api', function (req, res) {
    res.json({
        message: 'Welcome to v1 in nodeJS!  Below are the available endpoints, used like /v1/api/{endpoint}',
        endpoints: {
            "/create": "POST - Create a new object.",
            "/update": "PUT - Update the body an existing object.",
            "/patch": "PATCH - Update the properties of an existing object.",
            "/set": "PATCH - Update the body an existing object by adding a new property.",
            "/unset": "PATCH - Update the body an existing object by removing an existing property.",
            "/delete": "DELETE - Mark an object as deleted.",
            "/query": "POST - Supply a JSON object to match on, and query the db for an array of matches."
        }
    })
})

/**
* Support GET requests like v1/id/{object id}  
*/
router.route('/since/:_id')
    .get(controller.since)
    .post((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })
    .patch((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })
    .head(controller.sinceHeadRequest)
    .delete((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })

/**
* Support GET requests like v1/id/{object id}  
*/
router.route('/history/:_id')
    .get(controller.history)
    .post((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })
    .patch((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })
    .head(controller.historyHeadRequest)
    .delete((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
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
    .post(auth.checkJwt, (req, res) => {
        if (rest.checkPatchOverrideSupport()) {
            controller.patchSet(req, resp)
        }
        else {
            res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
            res.status(405)
            next()
        }
    })
    .put((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to add new keys to this object.'
        res.status(405)
        next()
    })
    .patch(auth.checkJwt, controller.patchSet)
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
    .post(auth.checkJwt, (req, res) => {
        if (rest.checkPatchOverrideSupport()) {
            controller.patchUnset(req, resp)
        }
        else {
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
    .patch(auth.checkJwt, controller.patchUnset)
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
    .delete(auth.checkJwt, controller.delete)


/**
 * Use this to catch 404s because of invalid /api/ paths and pass them to the error handler in app.js
 * 
 * Note while we have 501s, they will fall here.  Don't let them trick you.
 * Detect them and send them out, don't hand up to the 404 catcher in app.js
 */
router.use(function (req, res, next) {
    if (res.statusCode === 501) {
        //We can remove this once we implement the functions, for now we have to catch it here.
        let msg = res.statusMessage ?? "This is not yet implemented"
        res.status(501).send(msg).end()
    }
    else {
        //A 404 to pass along to our 404 handler in app.js
        next()
    }
})

// Export API routes
module.exports = router
