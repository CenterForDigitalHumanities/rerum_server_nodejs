#!/usr/bin/env node

/**
 * Module dependencies.
 */

var app = require('../app')
var debug = require('debug')('rerum_server_nodejs:server')
var http = require('http')
var config = require('../config')


/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(config.port)
app.set('port', port)

/**
 * Create HTTP server.
 */

var server = http.createServer(app)
const io = require('socket.io')(server)

/**
 * Connect to Mongo and listen on provided port, on all network interfaces.
 */
const database = require('../database')
database.connect(onConnected)

/**
 * Control the keep alive header
 */ 
// Ensure all inactive connections are terminated by the ALB, by setting this a few seconds higher than the ALB idle timeout
server.keepAliveTimeout = 8 * 1000 //8 seconds
// Ensure the headersTimeout is set higher than the keepAliveTimeout due to this nodejs regression bug: https://github.com/nodejs/node/issues/27363
server.headersTimeout = 8.5 * 1000 //8 seconds

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  const portCheck = parseInt(val, 10)

  if (isNaN(portCheck)) {
    // named pipe
    return val
  }

  if (portCheck >= 0) {
    // port number
    return portCheck
  }

  return false
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error
  }

  var bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges')
      process.exit(1)
      break
    case 'EADDRINUSE':
      console.error(bind + ' is already in use')
      process.exit(1)
      break
    default:
      throw error
  }
}

/**
 * Event listener for mongoDB connection event.
 */

function onConnected(err) {
  server.on('error', onError(err))
  server.listen(port,function(){
    console.log("LISTENING ON "+port)
    var addr = server.address()
    var bind = typeof addr === 'string'
      ? 'pipe ' + addr
      : 'port ' + addr.port
    debug('Listening on ' + bind)
  })
}

/**
 * Socket magic for npm stop
 * */
io.on('connection', (socketServer) => {
  socketServer.on('npmStop', () => {
    process.exit(0)
  })
})
