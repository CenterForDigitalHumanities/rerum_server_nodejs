#!/usr/bin/env node
const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const auth = require('../auth')

router.route('/:_id')
    .patch(auth.checkJwt, controller.release)
    .all((req, res) => {
        res.statusMessage = 'Improper request method for releasing, please use PATCH to release this object.'
        res.status(405)
        next()
    })

module.exports = router
