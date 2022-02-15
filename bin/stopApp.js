const io2 = require('socket.io-client');
const socketClient2 = io2.connect('http://localhost'); // Specify port if your express server is not using default port 80

socketClient2.on('connect', () => {
  socketClient2.emit('npmStop');
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});