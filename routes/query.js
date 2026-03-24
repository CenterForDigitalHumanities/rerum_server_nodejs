import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import { jsonContent } from '../rest.js'

router.route('/')
    .post(jsonContent, controller.query)
    .head(controller.queryHeadRequest)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for requesting objects with matching properties.  Please use POST.'
        res.status(405)
        next(res)
    })

export default router
