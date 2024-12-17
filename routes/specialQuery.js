import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'

router.route('/')
    .post(controller.specialQuery)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method.  Please use POST.'
        res.status(405)
        next(res)
    })

export default router
