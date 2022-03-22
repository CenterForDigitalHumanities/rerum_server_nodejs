#!/usr/bin/env node
const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const auth = require('../auth')

router.route('/')
    .put(auth.checkJwt, controller.overwrite)
    .all((req, res) => {
        res.statusMessage = 'Improper request method for overwriting, please use PUT to overwrite this object.'
        res.status(405)
        next()
    })

module.exports = router
