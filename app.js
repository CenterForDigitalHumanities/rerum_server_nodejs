#!/usr/bin/env node
//test it
var createError = require('http-errors')
var express = require('express')
var path = require('path')
var cookieParser = require('cookie-parser')
const dotenv = require('dotenv')
dotenv.config()
var logger = require('morgan')
const cors = require('cors')

var indexRouter = require('./routes/index.js')
var apiRouter = require('./routes/api-routes.js')

//var utils = require('utils.js')
var app = express()

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

//Middleware to use
app.use(cors()) //INVESTIGATE!!!
app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
//app.use(utils)

//Publicly available scripts, CSS, and HTML pages.
app.use(express.static(path.join(__dirname, 'public')))

//Assign routes to the app.  This is processing URL patterns and pointing them to servlet logic

/**
 * For any request that comes through to the app, check whether or not we are in maintenance mode.
 * If we are, then show the sad puppy.  Otherwise, continue on.
 * This is without middleware
 */ 
app.all('*', (req, res, next) => {
  if(process.env.down=="true"){
      res.status(503).send("RERUM v1 is down for updates or maintenance at this time.  We aplologize for the inconvenience.  Try again later.")
      res.redirect(301, "/maintenance.html")
  }
  else{
      next() //pass on to the next app.use
  }
})

/**
 * For any request that comes through to the app, check whether or not we are in maintenance mode.
 * If we are, then show the sad puppy.  Otherwise, continue on.
 * This is with middleware
 */ 
app.use('/', indexRouter)
app.use('/v1', apiRouter)

/*

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404))
})

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message
  res.locals.error = req.app.get('env') === 'development' ? err : {}

  // render the error page
  res.status(err.status || 500)
  res.render('error')
})

*/
module.exports = app
