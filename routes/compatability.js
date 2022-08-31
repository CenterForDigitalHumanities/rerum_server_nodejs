#!/usr/bin/env node
const router = require('express').Router()
// This controller reroutes older style API calls.

router.route("/:attemptedAction.action")
    .all((req, res, next) => {
        if (req.params.attemptedAction) {
            res.redirect(307,`./${req.params.attemptedAction}`)
            return
        }
    })
router.route("/:attemptedAction")
    .all((req, res, next) => {
        if (!req.params.attemptedAction) {
            next()
            return
        }
        if(req.params.attemptedAction === "accessToken") {
            res.redirect(307,`/client/request-new-access-token`)
            return
        }
        if(req.params.attemptedAction === "refreshToken") {
            res.redirect(307,`/client/request-new-refresh-token`)
            return
        }
        next()
    })

module.exports = router
