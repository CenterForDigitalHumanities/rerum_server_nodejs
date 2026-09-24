import express from 'express'
const router = express.Router()
import controller from '../db-controller.js'
import rest from '../rest.js'

// GoG-namespaced, stable, browser-cacheable URL returning the object with its targeting Annotations merged in.
router.route('/:_id')
    .get(controller.expandedId)
    .all((req, res, next) => {
        rest.sendMethodNotAllowed(res, 'Improper request method, please use GET.', 'GET,HEAD')
    })

export default router
