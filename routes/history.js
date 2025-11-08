import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import { cacheHistory } from '../cache/middleware.js'

router.route('/:_id')
    .get(cacheHistory, controller.history)
    .head(controller.historyHeadRequest)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next(res)
    })

export default router
