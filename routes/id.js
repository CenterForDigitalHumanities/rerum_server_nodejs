import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'

// No .head() here on purpose.  Express routes HEAD to the GET handler when no HEAD handler is
// registered, and suppresses the body itself, so HEAD answers with exactly the headers GET sends
// -- Cache-Control, Last-Modified, and the ETag Express derives from the body.  A hand-written
// HEAD handler cannot produce that ETag, and every header the GET gains later has to be
// duplicated into it or the two silently drift apart.  /gog/id/ already relies on this.
router.route('/:_id')
    .get(controller.id)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405).end()
    })

export default router

