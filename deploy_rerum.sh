#!/bin/bash
if [[ ! -e /logs/rerumlogs.txt ]]; then
    mkdir -p /logs
    touch /logs/rerumlogs.txt
fi
cd /rerum/proof-express-and-mongodb-driver
npm install
npm start >> /logs/rerumlogs.txt 2>&1 &
