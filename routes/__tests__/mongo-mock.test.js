jest.mock('mongodb')

describe('query', () => {
    const {
        constructorSpy,
        collectionSpy,
        createIndexSpy,
        databaseSpy,
        deleteOneSpy,
        findSpy,
        findOneSpy,
        insertOneSpy,
        updateOneSpy
    } = jest.requireMock('mongodb')

    beforeEach(() => {
        constructorSpy.mockClear();
        collectionSpy.mockClear();
        createIndexSpy.mockClear();
        databaseSpy.mockClear();
        deleteOneSpy.mockClear();
        findSpy.mockClear();
        findOneSpy.mockClear();
        insertOneSpy.mockClear();
        updateOneSpy.mockClear();
    })
    it('should connect and return a client', async () => {
        const url = 'mongodb://localhost:27017';
        const options = { keepAlive: true };
        const client = await createClient(url, options);

        expect(client).toBe('mock-client');
        expect(constructorSpy).toHaveBeenCalledWith(url, options);
    })
})
