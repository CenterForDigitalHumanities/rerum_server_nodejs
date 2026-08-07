import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import rest from '../rest.js'

router.route('/:_id/expanded')
    .get(controller.idExpanded)
    .post(rest.verifyJsonContentType, controller.idExpanded)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET or POST.'
        res.status(405).end()
    })

router.route('/:_id')
    .get(controller.id)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405).end()
    })

export default router

