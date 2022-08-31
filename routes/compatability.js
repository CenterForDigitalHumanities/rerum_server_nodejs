#!/usr/bin/env node
const router = require('express').Router()
// This controller reroutes older style API calls.

router.route("/api/:attemptedAction.action")
    .all((req, res) => {
        if (!req.params.attemptedAction) {
            next()
            return
        }
        req.redirect(`/api/${req.params.attemptedAction}`)
    })

module.exports = router
