import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import rest from '../rest.js'

router.route('/:_id')
    .get(controller.since)
    .all((req, res, next) => {
        rest.sendMethodNotAllowed(res, 'Improper request method, please use GET.', 'GET,HEAD')
    })

export default router
