# CLAUDE.md

This file provides guidance to AI assistants when working with code in this repository.

## Project Overview

RERUM API v1 is an open source Node.js/Express RESTful API server for the RERUM digital object repository. It stores any valid JSON object but prefers JSON-LD objects such as Web Annotations (https://www.w3.org/TR/annotation-model/) and IIIF Presentation API (https://iiif.io/api/presentation/3.0/) resources. The system emphasizes open access, attribution, versioning, and compliance with Linked Data standards.  It's responses follow RESTful best practices (https://restfulapi.net/http-status-codes/).  It is maintained by the Research Computing Group at Saint Louis University (https://www.slu.edu/research/faculty-resources/research-computing/index.php).

It is hosted on the web as a centralized API using a centralized database that many applications read from and write to concurrently.  It promotes and encourages open source development, and can be a cheap option as an API and back end for a web application.  A sanbox API and client application called TinyThings (https://tiny.rerum.io) gives developers an easy rapid prototyping option. That repo can be found at https://github.com/CenterForDigitalHumanities/TinyNode.

Users register with the RERUM API by signing up through Auth0.  This will generate a refresh token and an access token for those who sign up.  The access token is used as the Bearer Token on requests, which the RERUM API can then use to authenticate the request is from a registered RERUM application.  The refresh token can be used to get new access tokens through the RERUM API.  All data created and updated gets a `__rerum.generatedBy` property that is an Agent URI encoded in that token.  In this way, all data created an updated is attributed to specific application.  The API encourages applications to go a step further and attribute data to specific users with a user system and a `creator` property.

In production and development it is registered in a pm2 instance running on a 4-core RHEL VM.  It is started with `pm2 start -i max`, and so load balances across 4 instances.  The MongoDB that stores all the data is hosted through MongoDB Atlas.  The .github folder contains CI/CD for production and development deployment pipelines.


**Key Principles:**
- Save an object, retrieve an object—metadata lives in private `__rerum` property
- Trust the application, not the user—Auth0 JWT tokens for write operations
- Open and Free—no charge to read or write, all contributions exposed immediately
- Attributed and Versioned—all objects track ownership and transaction history

## Development Commands

### Setup and Installation
```bash
npm install                                           # Install dependencies (2-5 seconds)
```

### Running the Application
```bash
npm start                                             # Start server (http://localhost:3001 by default)
```

### Testing
```bash
npm run runtest                                       # Run full test suite (25+ minutes, requires MongoDB)
npm run runtest -- __tests__/routes_mounted.test.js  # Run route mounting tests (30 seconds, no DB needed)
npm run runtest -- routes/__tests__/create.test.js   # Run specific test file
```

**Important:** Use `npm run runtest` (not `npm test`) as it enables experimental VM modules required for ES6 imports in Jest.

### Development Workflow
```bash
# After making routing changes
npm run runtest -- __tests__/routes_mounted.test.js

# Test server startup
npm start  # Should display "LISTENING ON 3001" (or configured PORT)

# In another terminal, test endpoints
curl -I http://localhost:3001/v1/API.html
curl -X POST http://localhost:3001/v1/api/query -H "Content-Type: application/json" -d '{"test":"value"}'
```

## Architecture

### High-Level Structure

The application follows a **layered architecture** with clear separation of concerns:

```
app.js (Express setup, middleware)
  ↓
routes/api-routes.js (route mounting & definitions)
  ↓
routes/*.js (individual route handlers with JWT auth)
  ↓
db-controller.js (controller aggregator)
  ↓
controllers/*.js (business logic modules)
  ↓
database/index.js (MongoDB connection & operations)
```

### Key Architectural Components

**1. Request Flow:**
- Client → Express middleware (CORS, logging, body parsing)
- → Auth middleware (JWT validation via Auth0)
- → Route handlers (routes/*.js)
- → Controllers (controllers/*.js with business logic)
- → Database operations (MongoDB via database/index.js)
- → Response with proper Linked Data HTTP headers

**2. Versioning System:**
- Every object has a `__rerum` property with versioning metadata
- `history.prime`: Root object ID (or "root" if this is the prime)
- `history.previous`: Immediate parent version
- `history.next[]`: Array of child versions
- Updates create new objects with new IDs, maintaining version chains
- Released objects are immutable (isReleased !== "")

**3. Controllers Organization:**
The `db-controller.js` is a facade that imports from specialized controller modules:
- `controllers/crud.js`: Core create, query, id operations
- `controllers/update.js`: PUT/PATCH update operations (putUpdate, patchUpdate, patchSet, patchUnset, overwrite)
- `controllers/delete.js`: Delete operations
- `controllers/history.js`: Version history and since queries, HEAD request handlers
- `controllers/release.js`: Object release (immutability)
- `controllers/bulk.js`: Bulk create and update operations
- `controllers/search.js`: MongoDB text search (searchAsWords, searchAsPhrase)
- `controllers/gog.js`: Gallery of Glosses specific operations (fragments, glosses, expand)
- `controllers/utils.js`: Shared utilities (ID generation, slug handling, agent claims)

**4. Authentication & Authorization:**
- **Provider:** Auth0 JWT bearer tokens
- **Middleware:** `auth/index.js` with express-oauth2-jwt-bearer
- **Flow:** checkJwt array includes READONLY check, Auth0 validation, token error handling, user extraction
- **Agent Matching:** Write operations verify `req.user` matches `__rerum.generatedBy`
- **Bot Access:** Special bot tokens (BOT_TOKEN, BOT_AGENT) bypass some checks

**5. Special Features:**
- **Slug IDs:** Optional human-readable IDs via Slug header (e.g., "my-annotation")
- **PATCH Override:** X-HTTP-Method-Override header allows POST to emulate PATCH for clients without PATCH support
- **GOG Routes:** Specialized endpoints for Gallery of Glosses project (`/gog/fragmentsInManuscript`, `/gog/glossesInManuscript`)
- **Content Negotiation:** Handles both `@id`/`@context` (JSON-LD) and `id` (plain JSON) patterns

### Directory Structure

```
/bin/                   Entry point (rerum_v1.js creates HTTP server)
/routes/                Route handlers (one file per endpoint typically)
/controllers/           Business logic organized by domain
/auth/                  Authentication middleware and token handling
/database/              MongoDB connection and utilities
/public/                Static files (API.html docs, context.json)
/utils.js               Core utilities (__rerum configuration, header generation)
/rest.js                REST error handling and messaging
/app.js                 Express app setup and middleware configuration
/db-controller.js       Controller facade exporting all operations
```

## Important Patterns and Conventions

### 1. __rerum Property Management
Never trust client-provided `__rerum` data. Always use `utils.configureRerumOptions()` to set:
- `APIversion`, `createdAt`, `generatedBy`
- `history`: {prime, previous, next[]}
- `releases`: {previous, next[], replaces}
- `isOverwritten`, `isReleased`, `slug`

### 2. ID Handling
Objects have both MongoDB `_id` and JSON-LD `@id` or `id`:
- `_id`: MongoDB ObjectId (or slug if provided)
- `@id`: Full URI like `{RERUM_ID_PREFIX}{_id}`
- Use `idNegotiation()` to handle @context variations (some contexts prefer `id` over `@id`)
- Use `parseDocumentID()` to extract _id from full URIs

### 3. Error Handling
- Use `createExpressError(err)` from controllers/utils.js to format errors
- Let errors propagate to `rest.js` messenger middleware—don't res.send() in controllers
- Messenger adds helpful context based on status code (401, 403, 404, 405, 409, 500, 503)

### 4. Headers
- Use `utils.configureWebAnnoHeadersFor(obj)` for single objects (Content-Type, Link, Allow)
- Use `utils.configureLDHeadersFor(obj)` for arrays/query results
- Use `utils.configureLastModifiedHeader(obj)` for caching support
- Always set Location header on 201 Created responses

### 5. Maintenance Mode
Check `process.env.DOWN` and `process.env.READONLY`:
- DOWN="true": Return 503 for all requests
- READONLY="true": Block write operations (create/update/delete) with 503

### 6. Versioning Logic
When updating (PUT/PATCH):
1. Clone original object with its @id
2. Pass to `configureRerumOptions(generator, cloned, true, false)`
3. Insert as new object with new _id
4. Update original's `history.next[]` array to include new version's @id
5. Never modify released objects (isReleased check)

### 7. Deleted Objects
Deleted objects are transformed: `{"@id": "{id}", "__deleted": {original object properties, "time": ISO-date}}`.  The history trees there were a part of are healed to remain connected (this cannot be undone).  They are removed from /query and /search results, but deleted objects can always be retrieved by the URI id and will be returned in their deleted form. 

## Configuration

Create `.env` file in root with:

```bash
RERUM_API_VERSION=1.1.0
RERUM_BASE=http://localhost:3001
RERUM_PREFIX=http://localhost:3001/v1/
RERUM_ID_PREFIX=http://localhost:3001/v1/id/
RERUM_AGENT_CLAIM=http://localhost:3001/agent
RERUM_CONTEXT=http://localhost:3001/v1/context.json
RERUM_API_DOC=http://localhost:3001/v1/API.html
MONGO_CONNECTION_STRING=mongodb://localhost:27017
MONGODBNAME=rerum
MONGODBCOLLECTION=objects
DOWN=false
READONLY=false
PORT=3001

# Auth0 Configuration (contact research.computing@slu.edu)
AUDIENCE=your-audience
ISSUER_BASE_URL=https://your-tenant.auth0.com/
CLIENTID=your-client-id
RERUMSECRET=your-secret
BOT_TOKEN=your-bot-token
BOT_AGENT=your-bot-agent-url
```

## Testing Notes

- **Route tests** (`__tests__/routes_mounted.test.js`): Work without MongoDB, verify routing and static files
- **Controller tests** (`routes/__tests__/*.test.js`): Require MongoDB connection or will timeout after 5 seconds
- Tests use experimental VM modules, hence `npm run runtest` instead of `npm test`
- "Jest did not exit" warnings are normal—tests complete successfully despite this
- Most tests expect Auth0 to be configured; mock tokens are used in test environment

## Working Without MongoDB

**What works:**
- Server startup
- Static file serving (/v1/API.html, /v1/context.json, etc.)
- Route mounting and basic request handling
- Authentication handling (returns proper 401 errors)

**What fails:**
- All database operations return "Topology is closed" errors
- /query, /create, /update, /delete, /id/{id}, /history, /since

**Development tip:** Use route mounting tests to validate routing changes without requiring database setup.

## Common Gotchas

1. **Semicolons:** This codebase avoids unnecessary semicolons—follow existing style
2. **Guard clauses:** Prefer early returns over nested if/else for clarity
3. **Optional chaining:** Use `?.` and `??` operators when appropriate
4. **Node version:** Requires Node.js 22.20.0+ (specified in package.json engines).  Prefer to use active Node LTS release.
5. **ES2015 syntax:** Uses modern ES2015 javascript sytax
5. **Import statements:** Uses ES6 modules (`import`), not CommonJS (`require`)
6. **Controller returns:** Controllers call `next(err)` for errors and `res.json()` for success—don't mix both
7. **Version chains:** History and since queries follow bidirectional version relationships through prime, previous, and next properties

## API Endpoints Reference

Full documentation at http://localhost:3001/v1/API.html when server is running.

**Key endpoints:**
- POST `/v1/api/create` - Create new object
- PUT `/v1/api/update` - Version existing object via replacement
- PATCH `/v1/api/patch` - Version existing object via property update
- PATCH `/v1/api/set` - Add properties to existing object
- PATCH `/v1/api/unset` - Remove properties from existing object
- POST `/v1/api/overwrite` - Overwrite object without versioning
- DELETE `/v1/api/delete` - Mark object as deleted
- POST `/v1/api/query` - Query objects by properties
- POST `/v1/api/search` - Full-text search
- GET `/v1/id/{id}` - Retrieve object by ID or slug
- GET `/v1/history/{id}` - Get version history (ancestors)
- GET `/v1/since/{id}` - Get version descendants
- POST `/v1/api/release` - Lock object as immutable
- POST `/v1/api/bulkCreate` - Create multiple objects
- POST `/v1/api/bulkUpdate` - Update multiple objects

## Additional Resources

- Project homepage: https://rerum.io
- Public production instance: https://store.rerum.io
- Public development Instance: https://devstore.rerum.io
- RERUM API Document: https://store.rerum.io/API.html
- Repository: https://github.com/CenterForDigitalHumanities/rerum_server_nodejs
- Auth0 setup: Contact research.computing@slu.edu

## Additional Developer Preferences for AI Assistant Behavior

1. Do not automatically commit or push code.  Developers prefer to do this themselves when the time is right.
  - Make the code changes as requested.
  - Explain what changed and why.
  - Stop before committing.  The developer will decide at what point to commit changes on their own.  You do not need to keep track of it.
2. No auto compacting.  We will compact ourselves if the context gets too big.
3. When creating documentation do not add Claude as an @author.
4. Preference using current libraries and native javascript/ExpressJS/Node capabilities instead of installing new npm packages to solve a problem.
  - However, we understand that sometimes we need a package or a package is perfectly designed to solve our problem.  Ask if we want to use them in these cases.
5. We like colors in our terminals!  Be diverse and color text in the terminal for the different purposes of the text.  (ex. errors red, success green, logs bold white, etc.)
6. We like to see logs from running code, so expose those logs in the terminal logs as much as possible.
7. Use JDoc style for code documentation.  Cleanup, fix, or generate documentation for the code you work on as you encounter it. 
8. We use `npm start` often to run the app locally.  However, do not make code edits based on this assumption.  Production and development load balance in the app with pm2, not by using `npm start`
