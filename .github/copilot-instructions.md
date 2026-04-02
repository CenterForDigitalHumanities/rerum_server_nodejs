# RERUM API v1 Server
Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

RERUM API v1 is a NodeJS web service for interaction with the RERUM digital object repository. It stores JSON-LD objects including Web Annotations, SharedCanvas/IIIF objects, FOAF Agents, and any valid JSON objects. Visit [rerum.io](https://rerum.io) for general information and [store.rerum.io](https://store.rerum.io/) for the hosted public instance.

## Working Effectively

### Prerequisites
- **CRITICAL**: Node.js version 22.17.1 or higher is required (specified in package.json engines: ">=22.12.0")
- MongoDB database connection for full API functionality
- Git for version control

### Bootstrap and Setup
1. **Install Node.js 22.17.1**:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   source ~/.bashrc
   nvm install 22.17.1
   nvm use 22.17.1
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   - NEVER CANCEL: Takes 2-5 seconds. Set timeout to 30+ seconds.

3. **Create .env configuration file** (required for operation):
   ```bash
   # Create .env file in repository root
   RERUM_API_VERSION=1.1.0
   RERUM_BASE=http://localhost:3005
   RERUM_PREFIX=http://localhost:3005/v1/
   RERUM_ID_PREFIX=http://localhost:3005/v1/id/
   RERUM_AGENT_CLAIM=http://localhost:3005/agent
   RERUM_CONTEXT=http://localhost:3005/v1/context.json
   RERUM_API_DOC=http://localhost:3005/v1/API.html
   MONGO_CONNECTION_STRING=mongodb://localhost:27017/test
   MONGODBNAME=test_rerum
   MONGODBCOLLECTION=test_collection
   DOWN=false
   READONLY=false
   PORT=3005
   CLIENTID=test_client_id
   RERUMSECRET=test_secret
   BOT_TOKEN=test_bot_token
   BOT_AGENT=test_bot_agent
   AUDIENCE=test_audience
   ISSUER_BASE_URL=https://test.auth0.com/
   ```

### Testing
- **Route and Static File Tests** (work without database):
  ```bash
  npm run runtest -- __tests__/routes_mounted.test.js
  ```
  - NEVER CANCEL: Takes 30 seconds. Set timeout to 60+ seconds.

- **Full Test Suite** (requires MongoDB connection):
  ```bash
  npm run runtest
  ```
  - NEVER CANCEL: Takes 25+ minutes (many tests timeout without MongoDB). Set timeout to 45+ minutes.
  - **CRITICAL**: Most tests fail with 5-second timeouts if MongoDB is not connected - this is expected behavior in development environment.

### Running the Application
- **Start the server**:
  ```bash
  npm start
  ```
  - Server runs on `http://localhost:3005` (configurable via PORT in .env)
  - Takes 2-3 seconds to start
  - Displays "LISTENING ON 3005" when ready

- **Stop the server**: `CTRL + C` or `CTRL + X`

## Validation

### Manual Testing Scenarios
After making changes, ALWAYS validate these scenarios:

1. **Server Startup**: 
   ```bash
   npm start
   # Should display "LISTENING ON 3005" within 3 seconds
   ```

2. **Static File Serving**:
   ```bash
   curl -I http://localhost:3005/v1/API.html
   curl -I http://localhost:3005/v1/context.json
   curl -I http://localhost:3005/
   # Should return 200 OK responses
   ```

3. **Route Mounting**:
   ```bash
   npm run runtest -- __tests__/routes_mounted.test.js
   # Should pass all 17 tests in ~30 seconds
   ```

4. **API Authentication Behavior**:
   ```bash
   # Test create endpoint (matches example from Talend API Tester)
   curl -X POST http://localhost:3005/v1/api/create -H "Content-Type: application/json" -d '{"@":"5"}'
   # Should return 401 Unauthorized with proper auth message
   
   # Test with invalid token  
   curl -X POST http://localhost:3005/v1/api/create -H "Authorization: Bearer fake_token" -H "Content-Type: application/json" -d '{"@":"5"}'
   # Should return 401 with "This token did not contain a known RERUM agent"
   ```

5. **Database-dependent endpoints** (if MongoDB available):
   ```bash
   curl -X POST http://localhost:3005/v1/api/query -H "Content-Type: application/json" -d '{"test": "value"}'
   # Should either work with 200 OK or return "Topology is closed" error without MongoDB
   ```

### Working Without MongoDB
- **WORKS**: Server startup, static file serving, route mounting tests, authentication handling
- **FAILS**: All database operations (/query, /create, /update, /delete, /id/{id}, etc.) return "Topology is closed" errors
- **FOR DEVELOPMENT**: Use route mounting tests to validate routing changes without requiring database setup

## Common Tasks

### Key Directories
- `/routes/` - Route handlers and API endpoints (Express routes)
- `/controllers/` - Business logic controllers (CRUD operations, GOG-specific controllers)
- `/database/` - Database connection and utilities (MongoDB integration)
- `/auth/` - Authentication middleware (Auth0 JWT handling)
- `/public/` - Static files (API.html, context.json, etc.)
- `/__tests__/` - Test files (Jest test suites)
- `/bin/rerum_v1.js` - Main application entry point

### Important Files to Monitor
- `package.json` - Dependencies and scripts (requires Node.js 22+)
- `app.js` - Express application setup and middleware configuration
- `routes/api-routes.js` - Main API route definitions and mounting
- `.env` - Configuration (create from template above)
- `jest.config.js` - Test configuration (VM modules experimental)

### Architecture Notes
- **RESTful API**: Standard HTTP methods (GET, POST, PUT, PATCH, DELETE)
- **Authentication**: Auth0 JWT bearer tokens required for write operations
- **Database**: MongoDB for persistent storage, versioned objects
- **Static Files**: Served directly from `/public` directory
- **CORS**: Fully open ("*") for cross-origin requests
- **Specialized Routes**: Gallery of Glosses (GOG) specific endpoints in `_gog_*.js` files

### Coding Style Guidelines
- **Semicolons**: Avoid unnecessary semicolons (e.g., at the end of most lines)
- **Control Flow**: Prefer guard clauses over if/else statements when the meaning is clear
- **Modern JavaScript**: Use optional chaining (`?.`) and nullish coalescing (`??`) operators and ternaries for concise code when it doesn't compromise readability
- **Language**: Use inclusive language and labels throughout the codebase
- **Attribution**: Include attribution for contributed code or borrowed code at the top of each file

### Development Workflow
1. **After routing changes**: Always run basic route tests: `npm run runtest -- __tests__/routes_mounted.test.js`
2. **After configuration changes**: Test server startup: `npm start` (should display "LISTENING ON 3005")
3. **After API changes**: Test endpoints with curl as shown in validation scenarios
4. **For Auth0 integration testing**: Contact Research Computing Group at research.computing@slu.edu
5. **API reference**: Use documentation at http://localhost:3005/v1/API.html

### Complete Change Validation Example
```bash
# 1. Make your changes to routes/controllers
# 2. Test route mounting
npm run runtest -- __tests__/routes_mounted.test.js

# 3. Test server startup  
npm start
# Should show "LISTENING ON 3005"

# 4. In another terminal, test endpoints
curl -I http://localhost:3005/v1/API.html
curl -X POST http://localhost:3005/v1/api/create -H "Content-Type: application/json" -d '{"test": "value"}'

# 5. Stop server: CTRL + C
```

### CI/CD Notes
- GitHub Actions run on Node.js 22
- Tests run with: `npm install && npm run runtest`
- Deploy uses PM2 for process management
- Development environment available via PR to main branch
- Production deploys on push to main branch

### Troubleshooting
- **"Unsupported engine" warnings**: Expected with Node.js 22+ due to express-oauth2-jwt-bearer package
- **Test timeouts**: Expected without MongoDB connection - focus on route mounting tests for development  
- **Port conflicts**: Change PORT in .env file if 3005 is taken
- **JWT/Auth errors**: Expected in development - requires Auth0 setup for full functionality
- **"Cannot use import statement outside a module"**: Use `npm run runtest` (not `npm test`) - requires experimental VM modules
- **"Jest did not exit" warning**: Normal behavior - tests complete successfully despite this warning

## Build and Timing Expectations
- **npm install**: 2-5 seconds, NEVER CANCEL (timeout: 30+ seconds)
- **Basic tests**: 30 seconds, NEVER CANCEL (timeout: 60+ seconds)  
- **Full test suite**: 25+ minutes with timeouts, NEVER CANCEL (timeout: 45+ minutes)
- **Server startup**: 2-3 seconds
- **No build step required** - Direct Node.js execution