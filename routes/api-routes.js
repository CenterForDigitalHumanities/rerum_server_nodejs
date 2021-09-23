#!/usr/bin/env node
let router = require('express').Router();
var controller = require('../db-controller.js');
const bodyParser = require('body-parser');
const jsonParser = bodyParser.json();

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
router.route('/id/:_id')
    .get(controller.id)

// api/getByProps handles a POST with body that is a JSON object of properties to match on.
router.route('/getByProps')
    .post(controller.getByProps, jsonParser)

// api/makeNew to make a simple object with _id and @id.
router.route("/makeNew")
    .get(controller.create)

    
// Export API routes
module.exports = router;
