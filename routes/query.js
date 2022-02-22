#!/usr/bin/env node
const queryRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  queryRoute
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

module.exports = queryRoute