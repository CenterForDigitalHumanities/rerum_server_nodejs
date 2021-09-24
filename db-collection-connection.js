#!/usr/bin/env node
const { MongoClient } = require('mongodb');
var mongodbCollection = mongoConnection().then(conn => conn.db(process.env.MONGODBNAME)).then(db => db.collection(process.env.MONGODBCOLLECTION))

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

module.exports = mongodbCollection;