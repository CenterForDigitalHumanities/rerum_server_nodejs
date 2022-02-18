const overwriteRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  overwriteRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    .post((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    .put(controller.overwrite, jsonParser)
    .patch((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for overwriting, please use PUT to overwrite this object.')
    })

module.exports = overwriteRoute