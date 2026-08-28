#!/usr/bin/env node
import express from 'express'
const router = express.Router()

//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import auth from '../auth/index.js'
import rest from '../rest.js'

router.route('/')
    .put(auth.checkJwt, rest.verifyJsonContentType, controller.bulkUpdate)
    .all((req, res, next) => {
        rest.sendMethodNotAllowed(res, 'Improper request method for creating, please use PUT.', 'PUT')
    })

export default router
