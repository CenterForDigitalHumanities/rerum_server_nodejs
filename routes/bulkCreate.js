#!/usr/bin/env node
const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const auth = require('../auth')

router.route('/')
    .post(auth.checkJwt, controller.bulkCreate)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for creating, please use POST.'
        res.status(405)
        next(res)
    })

module.exports = router
