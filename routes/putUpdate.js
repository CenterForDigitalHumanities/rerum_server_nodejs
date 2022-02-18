const putUpdateRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  putUpdateRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    .post((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    .put(controller.putUpdate, jsonParser)
    .patch((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PUT to update this object.')
    })

module.exports = putUpdateRoute