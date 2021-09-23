#!/usr/bin/env node
let router = require('express').Router();
var controller = require('../db-controller.js');

// Set default API response
router.get('/', function (req, res) {
    res.json({
        message: 'Welcome to v1 in nodeJS!'
    });
});

// API routes

// api/test to just return some JSON, no DB interactions
router.route('/test')
    .get(controller.index)

// api/getByID/_id to fire a request for http://devstore.rerum.io/v1/id/11111 from annotationStoreDev on img-01
router.route('/getByID/:_id')
    .get(controller.getByID)

// api/getByProp/_id to fire a request for http://devstore.rerum.io/v1/id/11111 from annotationStoreDev on img-01
router.route('/getByProp/:_id')
    .get(controller.getByProp)

// api/makeNew to make a simple object with _id and @id.
router.route("/makeNew")
    .get(controller.create)

// api/saveNew with an object in the body.  Didn't implement this, cuz the Model will hate it :(
router.route("/saveNew")
    .post(controller.save)
    
// Export API routes
module.exports = router;
