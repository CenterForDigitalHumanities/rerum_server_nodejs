const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

router.route('/id/:_id')
    .get(controller.id)
    .head(controller.idHeadRequest)
    .all((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })

module.exports = router

