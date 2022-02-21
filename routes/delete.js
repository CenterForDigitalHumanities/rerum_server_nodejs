#!/usr/bin/env node
const deleteRoute = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
//Utility functions
const utilities = require('../utils.js')
//RESTful behavior
const rest = require('../rest.js')

// https://stackoverflow.com/a/68151763/1413302 body-parser is already in express.json() now.  Confirm this, and remove bodyParser if so.
//const bodyParser = require('body-parser')
//const jsonParser = bodyParser.json()

  deleteRoute
    .get((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .post((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .put((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .patch((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .options(rest.optionsRequest)
    .head((req, res) => {
        res.status(405).send('Improper request method for deleting, please use DELETE.')
    })
    .delete(controller.delete)

module.exports = deleteRoute