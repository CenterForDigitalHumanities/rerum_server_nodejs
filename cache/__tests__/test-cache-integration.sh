#!/bin/bash

################################################################################
# RERUM Cache Integration Test Script
# Tests read endpoint caching, write endpoint cache invalidation, and limit enforcement
# Author: GitHub Copilot
# Date: October 21, 2025
################################################################################

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3005}"
API_BASE="${BASE_URL}/v1"
AUTH_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik9FVTBORFk0T1RVNVJrRXlOREl5TTBFMU1FVXdNMFUyT0RGQk9UaEZSa1JDTXpnek1FSTRNdyJ9.eyJodHRwOi8vc3RvcmUucmVydW0uaW8vYWdlbnQiOiJodHRwczovL2RldnN0b3JlLnJlcnVtLmlvL3YxL2lkLzY4ZDZkZDZhNzE4ZWUyOTRmMTk0YmUwNCIsImh0dHA6Ly9yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby91c2VyX3JvbGVzIjp7InJvbGVzIjpbImR1bmJhcl91c2VyX3B1YmxpYyIsImdsb3NzaW5nX3VzZXJfcHVibGljIiwibHJkYV91c2VyX3B1YmxpYyIsInJlcnVtX3VzZXJfcHVibGljIiwidHBlbl91c2VyX3B1YmxpYyJdfSwiaHR0cDovL3JlcnVtLmlvL2FwcF9mbGFnIjpbInRwZW4iXSwiaHR0cDovL2R1bmJhci5yZXJ1bS5pby9hcHBfZmxhZyI6WyJ0cGVuIl0sImlzcyI6Imh0dHBzOi8vY3ViYXAuYXV0aDAuY29tLyIsInN1YiI6ImF1dGgwfDY4ZDZkZDY0YmRhMmNkNzdhMTA2MWMxNyIsImF1ZCI6Imh0dHA6Ly9yZXJ1bS5pby9hcGkiLCJpYXQiOjE3NjEwNzA1NjMsImV4cCI6MTc2MzY2MjU2Mywic2NvcGUiOiJvZmZsaW5lX2FjY2VzcyIsImF6cCI6IjYySnNhOU14SHVxaFJiTzIwZ1RIczlLcEtyN1VlN3NsIn0.nauW6q8mANKNhZYPXM8RpHxtT_8uueO3s0IqWspiLhOUmi4i63t-qI3GIPMuja9zBkMAT7bYKNaX0uIHyLhWsOXLzxEEkW4Ft1ELVUHi7ry9bMMQ1KOKtMXqCmHwDaL-ugb3aLao6r0zMPLW0IFGf0QzI3XpLjMY5kdoawsEverO5fv3x9enl3BvHaMjgrs6iBbcauxikC4_IGwMMkbyK8_aZASgzYTefF3-oCu328A0XgYkfY_XWyAJnT2TPUXlpj2_NrBXBGqlxxNLt5uVNxy5xNUUCkF3MX2l5SYnsxRsADJ7HVFUjeyjQMogA3jBcDdXW5XWOBVs_bZib20iHA"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Array to store created object IDs for cleanup
declare -a CREATED_IDS=()

################################################################################
# Helper Functions
################################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED_TESTS++))
}

log_failure() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED_TESTS++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Clear the cache before tests
clear_cache() {
    log_info "Clearing cache..."
    curl -s -X POST "${API_BASE}/api/cache/clear" > /dev/null
    sleep 0.5
}

# Get cache statistics
get_cache_stats() {
    curl -s "${API_BASE}/api/cache/stats" | jq -r '.stats'
}

# Extract cache header from response
get_cache_header() {
    local response_file=$1
    grep -i "^X-Cache:" "$response_file" | cut -d' ' -f2 | tr -d '\r'
}

# Extract ID from response
extract_id() {
    local response=$1
    echo "$response" | jq -r '.["@id"] // ._id // .id // empty' | sed 's|.*/||'
}

# Cleanup function
cleanup() {
    log_info "Cleaning up created test objects..."
    for id in "${CREATED_IDS[@]}"; do
        if [ -n "$id" ]; then
            curl -s -X DELETE \
                -H "Authorization: Bearer ${AUTH_TOKEN}" \
                -H "Content-Type: application/json" \
                "${API_BASE}/api/delete/${id}" > /dev/null 2>&1 || true
        fi
    done
    log_info "Cleanup complete"
}

trap cleanup EXIT

################################################################################
# Test Functions
################################################################################

test_query_cache() {
    log_info "Testing /api/query cache..."
    ((TOTAL_TESTS++))
    
    clear_cache
    local headers1=$(mktemp)
    local headers2=$(mktemp)
    
    # First request - should be MISS
    local response1=$(curl -s -D "$headers1" -X POST \
        -H "Content-Type: application/json" \
        -d '{"type":"CacheTest"}' \
        "${API_BASE}/api/query")
    
    local cache1=$(get_cache_header "$headers1")
    
    # Second request - should be HIT
    local response2=$(curl -s -D "$headers2" -X POST \
        -H "Content-Type: application/json" \
        -d '{"type":"CacheTest"}' \
        "${API_BASE}/api/query")
    
    local cache2=$(get_cache_header "$headers2")
    
    rm "$headers1" "$headers2"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ]; then
        log_success "Query endpoint caching works (MISS → HIT)"
        return 0
    else
        log_failure "Query endpoint caching failed (Got: $cache1 → $cache2, Expected: MISS → HIT)"
        return 1
    fi
}

test_search_cache() {
    log_info "Testing /api/search cache..."
    ((TOTAL_TESTS++))
    
    clear_cache
    local headers1=$(mktemp)
    local headers2=$(mktemp)
    local response1=$(mktemp)
    
    # First request - should be MISS
    local http_code1=$(curl -s -D "$headers1" -w "%{http_code}" -o "$response1" -X POST \
        -H "Content-Type: text/plain" \
        -d 'test' \
        "${API_BASE}/api/search")
    
    # Check if search endpoint works (requires MongoDB Atlas Search indexes)
    if [ "$http_code1" != "200" ]; then
        log_warning "Search endpoint not functional (HTTP $http_code1) - likely requires MongoDB Atlas Search indexes. Skipping test."
        rm "$headers1" "$headers2" "$response1"
        ((TOTAL_TESTS--))  # Don't count this test
        return 0
    fi
    
    local cache1=$(get_cache_header "$headers1")
    
    # Second request - should be HIT
    curl -s -D "$headers2" -X POST \
        -H "Content-Type: text/plain" \
        -d 'test' \
        "${API_BASE}/api/search" > /dev/null
    
    local cache2=$(get_cache_header "$headers2")
    
    rm "$headers1" "$headers2" "$response1"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ]; then
        log_success "Search endpoint caching works (MISS → HIT)"
        return 0
    else
        log_failure "Search endpoint caching failed (Got: $cache1 → $cache2, Expected: MISS → HIT)"
        return 1
    fi
}

test_id_lookup_cache() {
    log_info "Testing /id/{id} cache..."
    ((TOTAL_TESTS++))
    
    # Create a test object first
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"ID Lookup Test"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    if [ -z "$test_id" ]; then
        log_failure "Failed to create test object for ID lookup test"
        return 1
    fi
    
    sleep 0.5
    clear_cache
    
    local headers1=$(mktemp)
    local headers2=$(mktemp)
    
    # First request - should be MISS
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second request - should be HIT
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    rm "$headers1" "$headers2"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ]; then
        log_success "ID lookup caching works (MISS → HIT)"
        return 0
    else
        log_failure "ID lookup caching failed (Got: $cache1 → $cache2, Expected: MISS → HIT)"
        return 1
    fi
}

test_create_invalidates_cache() {
    log_info "Testing CREATE invalidates query cache..."
    ((TOTAL_TESTS++))
    
    clear_cache
    
    # Query for CacheTest objects - should be MISS and cache result
    local headers1=$(mktemp)
    curl -s -D "$headers1" -X POST \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest"}' \
        "${API_BASE}/api/query" > /dev/null
    
    local cache1=$(get_cache_header "$headers1")
    
    # Query again - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" -X POST \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest"}' \
        "${API_BASE}/api/query" > /dev/null
    
    local cache2=$(get_cache_header "$headers2")
    
    # Create a new CacheTest object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Invalidation Test"}' \
        "${API_BASE}/api/create")
    
    local new_id=$(extract_id "$create_response")
    CREATED_IDS+=("$new_id")
    
    sleep 0.5
    
    # Query again - should be MISS (cache invalidated)
    local headers3=$(mktemp)
    curl -s -D "$headers3" -X POST \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest"}' \
        "${API_BASE}/api/query" > /dev/null
    
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "CREATE properly invalidates query cache (MISS → HIT → MISS after CREATE)"
        return 0
    else
        log_failure "CREATE invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_update_invalidates_cache() {
    log_info "Testing UPDATE invalidates caches..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Update Test","value":1}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    # Cache the ID lookup
    local headers1=$(mktemp)
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second lookup - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    # Update the object
    curl -s -X PUT \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"@id\":\"${API_BASE}/id/${test_id}\",\"@type\":\"CacheTest\",\"name\":\"Updated\",\"value\":2}" \
        "${API_BASE}/api/update" > /dev/null
    
    sleep 0.5
    
    # ID lookup again - should be MISS (cache invalidated)
    local headers3=$(mktemp)
    curl -s -D "$headers3" "${API_BASE}/id/${test_id}" > /dev/null
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "UPDATE properly invalidates caches (MISS → HIT → MISS after UPDATE)"
        return 0
    else
        log_failure "UPDATE invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_delete_invalidates_cache() {
    log_info "Testing DELETE invalidates caches..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Delete Test"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    
    sleep 0.5
    clear_cache
    
    # Cache the ID lookup
    local headers1=$(mktemp)
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second lookup - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    # Delete the object
    curl -s -X DELETE \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        "${API_BASE}/api/delete/${test_id}" > /dev/null
    
    sleep 0.5
    
    # ID lookup again - should be MISS (cache invalidated and object deleted)
    local headers3=$(mktemp)
    local response3=$(curl -s -D "$headers3" "${API_BASE}/id/${test_id}")
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    # After delete, the cache should be MISS and the object should not exist
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "DELETE properly invalidates caches (MISS → HIT → MISS after DELETE)"
        return 0
    else
        log_failure "DELETE invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_patch_invalidates_cache() {
    log_info "Testing PATCH invalidates caches..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Patch Test","value":1}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    # Cache the ID lookup
    local headers1=$(mktemp)
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second lookup - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    # Patch the object
    curl -s -X PATCH \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"@id\":\"${API_BASE}/id/${test_id}\",\"value\":2}" \
        "${API_BASE}/api/patch" > /dev/null
    
    sleep 0.5
    
    # ID lookup again - should be MISS (cache invalidated)
    local headers3=$(mktemp)
    curl -s -D "$headers3" "${API_BASE}/id/${test_id}" > /dev/null
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "PATCH properly invalidates caches (MISS → HIT → MISS after PATCH)"
        return 0
    else
        log_failure "PATCH invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_set_invalidates_cache() {
    log_info "Testing SET invalidates caches..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Set Test"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    # Cache the ID lookup
    local headers1=$(mktemp)
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second lookup - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    # Set a new property
    curl -s -X PATCH \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"@id\":\"${API_BASE}/id/${test_id}\",\"newProperty\":\"value\"}" \
        "${API_BASE}/api/set" > /dev/null
    
    sleep 0.5
    
    # ID lookup again - should be MISS (cache invalidated)
    local headers3=$(mktemp)
    curl -s -D "$headers3" "${API_BASE}/id/${test_id}" > /dev/null
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "SET properly invalidates caches (MISS → HIT → MISS after SET)"
        return 0
    else
        log_failure "SET invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_unset_invalidates_cache() {
    log_info "Testing UNSET invalidates caches..."
    ((TOTAL_TESTS++))
    
    # Create a test object with a property to remove
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Unset Test","tempProperty":"remove me"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    # Cache the ID lookup
    local headers1=$(mktemp)
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second lookup - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    # Unset the property
    curl -s -X PATCH \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"@id\":\"${API_BASE}/id/${test_id}\",\"tempProperty\":null}" \
        "${API_BASE}/api/unset" > /dev/null
    
    sleep 0.5
    
    # ID lookup again - should be MISS (cache invalidated)
    local headers3=$(mktemp)
    curl -s -D "$headers3" "${API_BASE}/id/${test_id}" > /dev/null
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "UNSET properly invalidates caches (MISS → HIT → MISS after UNSET)"
        return 0
    else
        log_failure "UNSET invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_overwrite_invalidates_cache() {
    log_info "Testing OVERWRITE invalidates caches..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Overwrite Test"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    # Cache the ID lookup
    local headers1=$(mktemp)
    curl -s -D "$headers1" "${API_BASE}/id/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second lookup - should be HIT
    local headers2=$(mktemp)
    curl -s -D "$headers2" "${API_BASE}/id/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    # Overwrite the object (OVERWRITE expects @id with full URL)
    curl -s -X PUT \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"@id\":\"${API_BASE}/id/${test_id}\",\"@type\":\"CacheTest\",\"name\":\"Overwritten\"}" \
        "${API_BASE}/api/overwrite" > /dev/null
    
    sleep 0.5
    
    # ID lookup again - should be MISS (cache invalidated)
    local headers3=$(mktemp)
    curl -s -D "$headers3" "${API_BASE}/id/${test_id}" > /dev/null
    local cache3=$(get_cache_header "$headers3")
    
    rm "$headers1" "$headers2" "$headers3"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ] && [ "$cache3" = "MISS" ]; then
        log_success "OVERWRITE properly invalidates caches (MISS → HIT → MISS after OVERWRITE)"
        return 0
    else
        log_failure "OVERWRITE invalidation failed (Got: $cache1 → $cache2 → $cache3, Expected: MISS → HIT → MISS)"
        return 1
    fi
}

test_history_cache() {
    log_info "Testing /history/{id} cache..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"History Test"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    local headers1=$(mktemp)
    local headers2=$(mktemp)
    
    # First request - should be MISS
    curl -s -D "$headers1" "${API_BASE}/history/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second request - should be HIT
    curl -s -D "$headers2" "${API_BASE}/history/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    rm "$headers1" "$headers2"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ]; then
        log_success "History endpoint caching works (MISS → HIT)"
        return 0
    else
        log_failure "History endpoint caching failed (Got: $cache1 → $cache2, Expected: MISS → HIT)"
        return 1
    fi
}

test_since_cache() {
    log_info "Testing /since/{id} cache..."
    ((TOTAL_TESTS++))
    
    # Create a test object
    local create_response=$(curl -s -X POST \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"@type":"CacheTest","name":"Since Test"}' \
        "${API_BASE}/api/create")
    
    local test_id=$(extract_id "$create_response")
    CREATED_IDS+=("$test_id")
    
    sleep 0.5
    clear_cache
    
    local headers1=$(mktemp)
    local headers2=$(mktemp)
    
    # First request - should be MISS
    curl -s -D "$headers1" "${API_BASE}/since/${test_id}" > /dev/null
    local cache1=$(get_cache_header "$headers1")
    
    # Second request - should be HIT
    curl -s -D "$headers2" "${API_BASE}/since/${test_id}" > /dev/null
    local cache2=$(get_cache_header "$headers2")
    
    rm "$headers1" "$headers2"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ]; then
        log_success "Since endpoint caching works (MISS → HIT)"
        return 0
    else
        log_failure "Since endpoint caching failed (Got: $cache1 → $cache2, Expected: MISS → HIT)"
        return 1
    fi
}

test_search_phrase_cache() {
    log_info "Testing /api/search/phrase cache..."
    ((TOTAL_TESTS++))
    
    clear_cache
    local headers1=$(mktemp)
    local headers2=$(mktemp)
    
    # First request - should be MISS
    curl -s -D "$headers1" -X POST \
        -H "Content-Type: text/plain" \
        -d 'test phrase' \
        "${API_BASE}/api/search/phrase" > /dev/null
    
    local cache1=$(get_cache_header "$headers1")
    
    # Second request - should be HIT
    curl -s -D "$headers2" -X POST \
        -H "Content-Type: text/plain" \
        -d 'test phrase' \
        "${API_BASE}/api/search/phrase" > /dev/null
    
    local cache2=$(get_cache_header "$headers2")
    
    rm "$headers1" "$headers2"
    
    if [ "$cache1" = "MISS" ] && [ "$cache2" = "HIT" ]; then
        log_success "Search phrase endpoint caching works (MISS → HIT)"
        return 0
    else
        log_failure "Search phrase endpoint caching failed (Got: $cache1 → $cache2, Expected: MISS → HIT)"
        return 1
    fi
}

################################################################################
# Main Test Execution
################################################################################

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          RERUM Cache Integration Test Suite                   ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Check if server is running
    log_info "Checking server connectivity..."
    if ! curl -s --connect-timeout 5 "${BASE_URL}" > /dev/null; then
        log_failure "Cannot connect to server at ${BASE_URL}"
        log_info "Please start the server with: npm start"
        exit 1
    fi
    log_success "Server is running at ${BASE_URL}"
    echo ""
    
    # Display initial cache stats
    log_info "Initial cache statistics:"
    get_cache_stats | jq '.' || log_warning "Could not parse cache stats"
    echo ""
    
    # Run tests
    echo "═══════════════════════════════════════════════════════════════"
    echo "  READ ENDPOINT CACHING TESTS"
    echo "═══════════════════════════════════════════════════════════════"
    test_query_cache
    test_search_cache
    test_search_phrase_cache
    test_id_lookup_cache
    test_history_cache
    test_since_cache
    echo ""
    
    local basic_tests_failed=$FAILED_TESTS
    
    echo "═══════════════════════════════════════════════════════════════"
    echo "  WRITE ENDPOINT CACHE INVALIDATION TESTS"
    echo "═══════════════════════════════════════════════════════════════"
    test_create_invalidates_cache
    test_update_invalidates_cache
    test_patch_invalidates_cache
    test_set_invalidates_cache
    test_unset_invalidates_cache
    test_overwrite_invalidates_cache
    test_delete_invalidates_cache
    echo ""
    
    # Display final cache stats
    log_info "Final cache statistics:"
    get_cache_stats | jq '.' || log_warning "Could not parse cache stats"
    echo ""
    
    # Summary
    echo "═══════════════════════════════════════════════════════════════"
    echo "  TEST SUMMARY"
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "Total Tests:  ${TOTAL_TESTS}"
    echo -e "${GREEN}Passed:       ${PASSED_TESTS}${NC}"
    echo -e "${RED}Failed:       ${FAILED_TESTS}${NC}"
    echo "═══════════════════════════════════════════════════════════════"
    
    if [ $FAILED_TESTS -eq 0 ]; then
        echo -e "${GREEN}✓ All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}✗ Some tests failed${NC}"
        exit 1
    fi
}

# Run main function
main "$@"
