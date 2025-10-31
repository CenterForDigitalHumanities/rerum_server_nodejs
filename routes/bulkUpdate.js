#!/usr/bin/env node
import express from 'express'
const router = express.Router()

//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import auth from '../auth/index.js'
import { invalidateCache } from '../cache/middleware.js'

router.route('/')
    .put(auth.checkJwt, invalidateCache, controller.bulkUpdate)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for creating, please use PUT.'
        res.status(405)
        next(res)
    })

export default router
