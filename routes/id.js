const idRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')
  idRoute
    .get(controller.id)
    .post((req, res) => {
        res.status(405).send('Improper request method for reading, please use GET or request for headers with HEAD.')
    })
    .put((req, res) => {
        res.status(405).send('Improper request method for reading, please use GET or request for headers with HEAD.')
    })
    .patch((req, res) => {
        res.status(405).send('Improper request method for reading, please use GET or request for headers with HEAD.')
    })
    .options(rest.optionsRequest)
    .head(controller.idHeadRequest)

module.exports = idRoute