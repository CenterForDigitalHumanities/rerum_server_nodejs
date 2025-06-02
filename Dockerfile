FROM node:slim

WORKDIR app/

COPY . .

RUN npm install

EXPOSE 3001

CMD ["node", "./bin/rerum_v1.js"]