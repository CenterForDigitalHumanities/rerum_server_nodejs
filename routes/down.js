var express = require('express')
var router = express.Router()

/* GET home page. */
router.all('/*', function(req, res, next) {
  const down = process.env.down
  if(down){
      req.status(503).redirectToSadFace()
  }
  else{
      next() //pass on to the next app.use
  }
})

module.exports = router
