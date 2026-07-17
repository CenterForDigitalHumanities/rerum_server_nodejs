import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'

// GoG-namespaced, stable, browser-cacheable URL returning the object with its targeting
// Annotations merged in.  The front end fetches this instead of expanding client-side (issue #310).
router.route('/:_id')
    .get(controller.expandedId)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405).end()
    })

export default router
