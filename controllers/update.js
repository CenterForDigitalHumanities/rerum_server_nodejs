#!/usr/bin/env node

/**
 * Update controller aggregator for RERUM operations
 * This file imports and re-exports all update operations
 * @author Claude Sonnet 4, cubap, thehabes
 */

// Import individual update operations
import { putUpdate } from './putUpdate.js'
import { patchUpdate } from './patchUpdate.js'
import { patchSet } from './patchSet.js'
import { patchUnset } from './patchUnset.js'
import { overwrite } from './overwrite.js'

export { putUpdate, patchUpdate, patchSet, patchUnset, overwrite }
