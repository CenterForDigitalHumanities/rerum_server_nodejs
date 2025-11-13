import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'
import auth from '../auth/index.js'
import { cacheGogGlosses } from '../cache/middleware.js'

router.route('/')
    .post(auth.checkJwt, cacheGogGlosses, controller._gog_glosses_from_manuscript)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method.  Please use POST.'
        res.status(405)
        next(res)
    })

export default router