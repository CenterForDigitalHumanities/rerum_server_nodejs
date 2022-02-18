const createRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  createRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for creating, please use POST.')
    })
    .post(controller.create, jsonParser)
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

module.exports = createRoute