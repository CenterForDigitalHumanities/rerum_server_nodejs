const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')
const auth = require('../auth')

router.route('/:_id')
    .delete(auth.checkJwt, controller.delete)
    .all((req, res) => {
        res.statusMessage = 'Improper request method for deleting, please use DELETE.'
        res.status(405)
        next()
    })

module.exports = router
