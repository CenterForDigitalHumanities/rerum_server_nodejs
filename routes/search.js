import express from 'express'
const router = express.Router()
//This controller will handle all MongoDB interactions.
import controller from '../db-controller.js'

router.route('/')
    .post(controller.searchAsWords)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for search.  Please use POST.'
        res.status(405)
        next(res)
    })

router.route('/phrase')
    .post(controller.searchAsPhrase)
    .all((req, res, next) => {
        res.statusMessage = 'Improper request method for search.  Please use POST.'
        res.status(405)
        next(res)
    })

export default router