#!/usr/bin/env node
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

var logger = require('morgan');
let mongoose = require('mongoose');

var db = mongooseConnection()
.then(conn => {
  console.log("mongoose is connected")
  return conn
})

var indexRouter = require('./routes/index');
var apiRouter = require('./routes/api-routes.js');
var app = express();


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//Middleware to use
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

//Publicly available scripts, CSS, and HTML pages.
app.use(express.static(path.join(__dirname, 'public')));

//Assign routes to the app.  This is processing URL patterns and pointing them to servlet logic
app.use('/', indexRouter);
app.use('/v1', apiRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

//Connect to a mongodb via mongoose.
async function mongooseConnection(){
  console.log("Awaiting mongoose connection...")
  try {
      await mongoose.connect(process.env.ATLAS_CONNECTION_STRING, { useNewUrlParser: true});
      console.log("...returning mongoose connection");
      return mongoose.connection;
  } 
  catch (err) {
    console.log('mongoose.connect error in app initializer: ');
    return err;
  } 
}

//Connect to a mongodb via mongodb node driver.
async function mongoConnection(){
  console.log("Awaiting mongo connection...")
  try {
      const client = new MongoClient(process.env.ATLAS_CONNECTION_STRING2);
      let clientConnection = await client.connect();
      console.log('Connected successfully to mongodb client');
      //const db = client.db(dbName);
      //const collection = db.collection('documents');
      return clientConnection;
  } 
  catch (err) {
    console.log('mongo connect error in app initializer: ');
    return err;
  } 
}

module.exports = app;
