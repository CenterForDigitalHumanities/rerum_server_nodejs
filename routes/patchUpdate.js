#!/usr/bin/env node
const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const rest = require('../rest.js')
const auth = require('../auth')

router.route('/')
.post(auth.checkJwt, (req, res) => {
    if (rest.checkPatchOverrideSupport()) {
        controller.patchUpdate(req, resp)
    }
    else {
        res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
        res.status(405)
        next()
    }
})  
  .all((req, res) => {
        res.statusMessage = 'Improper request method for updating, please use PATCH to alter existing keys on this object.'
        res.status(405)
        next()
    })

module.exports = router
