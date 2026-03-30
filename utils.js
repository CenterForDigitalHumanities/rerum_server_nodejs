#!/usr/bin/env node

// The original utils.js was becoming overly large.  Many of its helper functions
// have been split into focused modules in the project root.  This file now
// simply re‑exports them so existing imports (`import utils from '../utils.js'`)
// continue to work.

import versioning from './versioning.js'
import headers from './headers.js'
import predicates from './predicates.js'

export default {
    // versioning helpers
    ...versioning,

    // predicates and checks
    ...predicates,

    // header constructors
    ...headers
}

export { configureRerumOptions } from './versioning.js'
export { configureWebAnnoHeadersFor, configureLDHeadersFor, configureLastModifiedHeader } from './headers.js'
export { isDeleted, isReleased, isGenerator, isContainerType, isLD } from './predicates.js'
