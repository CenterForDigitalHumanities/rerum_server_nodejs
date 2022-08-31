#!/usr/bin/env node
const router = require('express').Router()
// This controller reroutes older style API calls.

router.route("/:attemptedAction.action")
    .all((req, res, next) => {
        if (!req.params.attemptedAction) {
            next()
            return
        }
        res.redirect(`/v1/api/${req.params.attemptedAction}`)
    })

module.exports = router
