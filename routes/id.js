const router = require('express').Router()
//This controller will handle all MongoDB interactions.
const controller = require('../db-controller.js')

router.route('/:_id')
    .get(controller.id)
    .head(controller.idHeadRequest)
    .all((req, res) => {
        res.statusMessage = 'Improper request method, please use GET.'
        res.status(405)
        next()
    })

module.exports = router

