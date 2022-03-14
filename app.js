#!/usr/bin/env node
//test it
var createError = require('http-errors')
var express = require('express')
var path = require('path')
var cookieParser = require('cookie-parser')
var dotenv = require('dotenv')
var dotenvExpand = require('dotenv-expand')
var storedEnv = dotenv.config()
dotenvExpand.expand(storedEnv)
var logger = require('morgan')
const cors = require('cors')

var indexRouter = require('./routes/index.js')
var apiRouter = require('./routes/api-routes.js')

//var utils = require('utils.js')
const rest = require('./rest.js')
var app = express()

// view engine setup
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'ejs')

//Middleware to use
app.use(cors())
app.use(logger('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())
//app.use(utils)

//Publicly available scripts, CSS, and HTML pages.
app.use(express.static(path.join(__dirname, 'public')))


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

app.use('/', indexRouter)
app.use('/v1', apiRouter)

/**
 * Handle API errors and warnings RESTfully.  All routes that don't end in res.send() will end up here.
 * Important to note that res.json() will fail to here
 * Important to note api-routes.js handles all the 405s without failing to here - they res.send()
 * Important to note that failures in the controller from the mongo client will fail to here
 * 
 * */
app.use(rest.messenger)

//catch 404 because of an invalid site path
app.use(function(req, res, next) {
    let msg = res.statusMessage ? res.statusMessage : "This page does not exist"
    res.status(404).send(msg)  
    res.end()
})

module.exports = app
