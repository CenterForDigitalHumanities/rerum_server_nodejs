import express from 'express'
const router = express.Router()
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

// Note that there are more search functions available in the controller, such as controller.searchFuzzily
// They can be used through additional endpoints here when we are ready.

export default router