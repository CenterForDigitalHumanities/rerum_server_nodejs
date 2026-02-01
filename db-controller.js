#!/usr/bin/env node

/**
 * Main controller aggregating all RERUM operations
 * This file now imports from organized controller modules
 * @author Claude Sonnet 4, cubap, thehabes
 */

// Import controller modules
import { index, idNegotiation, generateSlugId, remove } from './controllers/utils.js'
import { create, query, id } from './controllers/crud.js'
import { searchAsWords, searchAsPhrase } from './controllers/search.js'
import { deleteObj } from './controllers/delete.js'
import { putUpdate, patchUpdate, patchSet, patchUnset, overwrite } from './controllers/update.js'
import { bulkCreate, bulkUpdate } from './controllers/bulk.js'
import { since, history, idHeadRequest, queryHeadRequest, sinceHeadRequest, historyHeadRequest } from './controllers/history.js'
import { release } from './controllers/release.js'
import { _gog_fragments_from_manuscript, _gog_glosses_from_manuscript, expand } from './controllers/gog.js'

export default {
    index,
    create,
    deleteObj,
    putUpdate,
    patchUpdate,
    patchSet,
    patchUnset,
    generateSlugId,
    overwrite,
    release,
    query,
    searchAsWords,
    searchAsPhrase,
    id,
    bulkCreate,
    bulkUpdate,
    idHeadRequest,
    queryHeadRequest,
    since,
    history,
    sinceHeadRequest,
    historyHeadRequest,
    remove,
    _gog_glosses_from_manuscript,
    _gog_fragments_from_manuscript,
    idNegotiation,
    expand
}
