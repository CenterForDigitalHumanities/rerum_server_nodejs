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

const staticRouter = require('./static.js')
router.use(staticRouter)

// Support GET requests like v1/id/{object id}  
const idRouter = require('./id.js')
router.use('/id',idRouter)

// Support POST requests with JSON bodies used for passing queries though to the database.
const queryRouter = require('./query.js')
router.use('/api/query', queryRouter)

// Support POST requests with JSON bodies used for establishing new objects.
const createRouter = require('./create.js')
router.use('/api/create', createRouter)

// Support DELETE requests like v1/delete/{object id} to mark an object as __deleted.
const deleteRouter = require('./delete.js')
router.use('/api/delete', deleteRouter)

// Support POST requests with JSON bodies used for replacing some existing object.
const overwriteRouter = require('./overwrite.js')
router.use('/api/overwrite', overwriteRouter)

// Support PATCH requests (that may contain a Slug header or ?slug parameter) to mark as object as released.
const releaseRouter = require('./release.js')
router.use('/api/release', releaseRouter)

// Support PUT requests with JSON bodies used for versioning an existing object through replacement.
const updateRouter = require('./putUpdate.js')
router.use('/api/update', updateRouter)

// Support PATCH requests with JSON bodies used for versioning an existing object through key/value setting.
const patchRouter = require('./patchUpdate.js')
router.use('/api/patch', patchRouter)

// Support PATCH requests with JSON bodies used for creating new keys in some existing object.
const setRouter = require('./patchSet.js')
router.use('/api/set', setRouter)

// Support PATCH requests with JSON bodies used for removing keys in some existing object.
const unsetRouter = require('./patchUnset.js')
router.use('/api/unset', unsetRouter)

// Support GET requests like v1/since/{object id} to discover all versions from all sources updating this version.
const sinceRouter = require('./since.js')
router.use('/since', sinceRouter)

// Support GET requests like v1/history/{object id} to discover all previous versions tracing back to the prime.
const historyRouter = require('./history.js')
router.use('/history', historyRouter)

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
