const dotenv = require('dotenv')

dotenv.config()

exports.config = {
    version: process.env.RERUM_API_VERSION,
    mongo: {
        uri: process.env.MONGO_CONNECTION_STRING,
        options: {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            useCreateIndex: true,
            useFindAndModify: false,
        },
        collection: process.env.MONGODBCOLLECTION,
        db: process.env.MONGODBDBNAME,
    },
    base_url: process.env.RERUM_BASE,
    audience: process.env.AUDIENCE,
    prefix: process.env.RERUM_PREFIX,
    id_prefix: process.env.RERUM_ID_PREFIX,
    context: process.env.RERUM_CONTEXT,
    agent_claim: process.env.RERUM_AGENT_CLAIM,
    port: process.env.PORT || 3001,
    jwtSecret: process.env.JWT_SECRET,
    jwtExpirationInterval: process.env.JWT_EXPIRATION_MINUTES,
    
    test: {
        issuer: process.env.ISSUER_BASE_URL,
        docs: process.env.RERUM_API_DOC
    }
}
