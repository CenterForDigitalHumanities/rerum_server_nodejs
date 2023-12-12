exports.default = {
    version: 'dev',
    mongo: {
        uri: '',
        options: { },
        collection: 'annotationStoreTest',
        db: 'alpha',
    },
    base_url: 'https://test.rerum.io/',
    audience: '',
    prefix: 'https://test.rerum.io/',
    id_prefix: 'https://test.rerum.io/v1/id/',
    context: 'http://test.rerum.io/context.json',
    agent_claim: '',
    port: 3003,
    jwtSecret: '',
    jwtExpirationInterval: 9999,
    
    test: {
        issuer: 'http://example.com',
        docs: ''
    }
}
