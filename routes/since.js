import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'

// No .head() here on purpose -- see routes/id.js.  Express answers HEAD with the GET handler and
// drops the body itself, so HEAD keeps the LD headers and the ETag a hand-written handler cannot
// produce.  The HEAD handler this replaced repeated the whole version-graph traversal to compute
// nothing the GET did not already compute.
router.route('/:_id')
    .get(controller.since)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405).end()
    })

export default router
