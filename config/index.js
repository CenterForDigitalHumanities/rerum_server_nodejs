import dotenv from 'dotenv'
dotenv.config()

const config = {
  MONGO_CONNECTION_STRING: process.env.MONGO_CONNECTION_STRING ?? 'mongodb://localhost:27017',
  MONGODBNAME: process.env.MONGODBNAME ?? 'rerum',
  MONGODBCOLLECTION: process.env.MONGODBCOLLECTION ?? 'objects',
  DOWN: process.env.DOWN ?? 'false',
  READONLY: process.env.READONLY ?? 'false',
  CLIENT_ID: process.env.CLIENT_ID ?? process.env.CLIENTID ?? '',
  CLIENT_SECRET: process.env.CLIENT_SECRET ?? process.env.RERUMSECRET ?? '',
  RERUM_PREFIX: process.env.RERUM_PREFIX ?? 'http://localhost:3005/v1/',
  RERUM_ID_PREFIX: process.env.RERUM_ID_PREFIX ?? 'http://localhost:3005/v1/id/',
  RERUM_AGENT_CLAIM: process.env.RERUM_AGENT_CLAIM ?? 'http://localhost:3005/agent',
  RERUM_CONTEXT: process.env.RERUM_CONTEXT ?? 'http://localhost:3005/v1/context.json',
  RERUM_API_VERSION: process.env.RERUM_API_VERSION ?? '1.0.0',
  BOT_AGENT: process.env.BOT_AGENT ?? '',
  AUDIENCE: process.env.AUDIENCE ?? '',
  ISSUER_BASE_URL: process.env.ISSUER_BASE_URL ?? '',
  BOT_TOKEN: process.env.BOT_TOKEN ?? '',
  PORT: parseInt(process.env.PORT ?? process.env.PORT_NUMBER ?? 3001, 10)
}

export default config
