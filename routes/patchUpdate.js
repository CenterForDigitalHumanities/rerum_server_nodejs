#!/usr/bin/env node
const patchUpdateRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

  patchUpdateRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    })
    .post((req, res) => {
        if(rest.checkPatchOverrideSupport()){
            controller.patchUpdate(req, resp)
        }
        else{
            res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')    
        }
    })
    .put((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    })
    .patch(controller.patchSet)
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for updating, please use PATCH to alter existing keys on this object.')
    })

module.exports = patchUpdateRoute