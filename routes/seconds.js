import express from "express"
const router = express.Router()

/* POST a query to the thing. */
router.get('/:_seconds', async (req, res, next) => {
  try {
    // check body for JSON
    let time = parseInt(req.params["_seconds"]) * 1000
    if (isNaN(time)) time=3000
    if (time > 100000) time = 100000

    let results = `Thanks for waiting ${time/1000} seconds.`
    setTimeout(function () {
      res.status(200)
      res.send(results)
    }, time)
  }
  catch (err) { // a dumb catch-all for Tiny Stuff
    next(err)
  }
})

router.all('/', (req, res, next) => {
  res.status(405).send("Method Not Allowed")
})

export default router
