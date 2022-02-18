const patchUnSetUpdateRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  patchUnSetUpdateRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to remove keys from this object.')
    })
    .post(rest.checkPatchOverrideSupport)
    .put((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to remove keys from this object.')
    })
    .patch(controller.patchUnset, jsonParser)
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to remove keys from this object.')
    })
module.exports = patchUnSetUpdateRoute