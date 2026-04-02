# CLAUDE.md

This file provides guidance to AI assistants when working with code in this repository.

## Project Overview

RERUM API v1 is an open source Node.js/Express RESTful API server for the RERUM digital object repository. It stores any valid JSON object but prefers JSON-LD objects such as Web Annotations (https://www.w3.org/TR/annotation-model/) and IIIF Presentation API (https://iiif.io/api/presentation/3.0/) resources. The system emphasizes open access, attribution, versioning, and compliance with Linked Data standards.  It's responses follow RESTful best practices (https://restfulapi.net/http-status-codes/).  It is maintained by the Research Computing Group at Saint Louis University (https://www.slu.edu/research/faculty-resources/research-computing/index.php).

## Common Gotchas

1. **Semicolons:** This codebase avoids unnecessary semicolons—follow existing style
2. **Guard clauses:** Prefer early returns over nested if/else for clarity
3. **Optional chaining:** Use `?.` and `??` operators when appropriate
4. **Node version:** Requires Node.js 22.20.0+ (specified in package.json engines).  Prefer to use active Node LTS release.
5. **ES2015 syntax:** Uses modern ES2015 javascript sytax
5. **Import statements:** Uses ES6 modules (`import`), not CommonJS (`require`)
6. **Controller returns:** Controllers call `next(err)` for errors and `res.json()` for success—don't mix both
7. **Version chains:** History and since queries follow bidirectional version relationships through prime, previous, and next properties

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
