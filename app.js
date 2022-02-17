#!/usr/bin/env node
//test
var createError = require('http-errors')
var express = require('express')
var path = require('path')
var cookieParser = require('cookie-parser')
const dotenv = require('dotenv')
dotenv.config()
var logger = require('morgan')

var indexRouter = require('./routes/index')
var apiRouter = require('./routes/api-routes.js')
var app = express()


// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

//Middleware to use
app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

//Publicly available scripts, CSS, and HTML pages.
app.use(express.static(path.join(__dirname, 'public')))

//Assign routes to the app.  This is processing URL patterns and pointing them to servlet logic
app.use('/', indexRouter)
app.use('/v1', apiRouter)

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



module.exports = app
