import express from 'express'
const router = express.Router()
import controller from '../db-controller.js'

// GoG-namespaced, stable, browser-cacheable URL returning the object with its targeting Annotations merged in.
router.route('/:_id')
    .get(controller.expandedId)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405).end()
    })

export default router
