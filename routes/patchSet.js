#!/usr/bin/env node
const patchSetUpdateRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  patchSetUpdateRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to add new keys object.')
    })
    .post(rest.checkPatchOverrideSupport)
    .put((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to add new keys object.')
    })
    .patch(controller.patchSet)
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to add new keys object.')
    })

module.exports = patchSetUpdateRoute