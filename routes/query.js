import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import rest from '../rest.js'

router.route('/')
    .post(rest.verifyJsonContentType, controller.query)
    .head(controller.queryHeadRequest)
    .all((req, res, next) => {
        rest.sendMethodNotAllowed(res, 'Improper request method for requesting objects with matching properties.  Please use POST.', 'POST,HEAD')
    })

export default router
