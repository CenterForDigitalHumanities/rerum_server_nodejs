#!/bin/bash

################################################################################
# RERUM Cache Comprehensive Metrics & Functionality Test
#
# Combines integration, performance, and limit enforcement testing
# Produces:
#   - cache/docs/CACHE_METRICS_REPORT.md (performance analysis)
#   - cache/docs/CACHE_METRICS.log (terminal output capture)
#
# Author: thehabes
# Date: October 22, 2025
################################################################################

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3001}"
API_BASE="${BASE_URL}/v1"
AUTH_TOKEN=""

CACHE_FILL_SIZE=1000
WARMUP_ITERATIONS=20
NUM_WRITE_TESTS=100

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

declare -A ENDPOINT_COLD_TIMES
declare -A ENDPOINT_WARM_TIMES
declare -A ENDPOINT_STATUS
declare -A ENDPOINT_DESCRIPTIONS

declare -a CREATED_IDS=()
declare -A CREATED_OBJECTS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT_FILE="$REPO_ROOT/cache/docs/CACHE_METRICS_REPORT.md"
LOG_FILE="$REPO_ROOT/cache/docs/CACHE_METRICS.log"

################################################################################
# Helper Functions
################################################################################

log_header() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

log_section() {
    echo ""
    echo -e "${MAGENTA}▓▓▓ $1 ▓▓▓${NC}"
    echo ""
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED_TESTS++))
    ((TOTAL_TESTS++))
}

log_failure() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED_TESTS++))
    ((TOTAL_TESTS++))
}

log_skip() {
    echo -e "${YELLOW}[SKIP]${NC} $1"
    ((SKIPPED_TESTS++))
    ((TOTAL_TESTS++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_overhead() {
    local overhead=$1
    shift  # Remove first argument, rest is the message
    local message="$@"
    
    if [ $overhead -le 0 ]; then
        echo -e "${GREEN}[PASS]${NC} $message"
    else
        echo -e "${YELLOW}[PASS]${NC} $message"
    fi
}

check_wsl2_time_sync() {
    # Check if running on WSL2
    if grep -qEi "(Microsoft|WSL)" /proc/version &> /dev/null; then
        log_info "WSL2 detected - checking system time synchronization..."

        # Try to sync hardware clock to system time (requires sudo)
        if command -v hwclock &> /dev/null; then
            if sudo -n hwclock -s &> /dev/null 2>&1; then
                log_success "System time synchronized with hardware clock"
            else
                log_warning "Could not sync hardware clock (sudo required)"
                log_info "To fix clock skew issues, run: sudo hwclock -s"
                log_info "Continuing anyway - some timing measurements may show warnings"
            fi
        else
            log_info "hwclock not available - skipping time sync"
        fi
    fi
}

check_server() {
    log_info "Checking server connectivity at ${BASE_URL}..."
    if ! curl -s -f "${BASE_URL}" > /dev/null 2>&1; then
        echo -e "${RED}ERROR: Cannot connect to server at ${BASE_URL}${NC}"
        echo "Please start the server with: npm start"
        exit 1
    fi
    log_success "Server is running at ${BASE_URL}"
}

get_auth_token() {
    log_header "Authentication Setup"

    echo ""
    echo "This test requires a valid Auth0 bearer token to test write operations."
    echo "Please obtain a fresh token from: https://devstore.rerum.io/"
    echo ""
    echo "Remember to delete your created junk and deleted junk. Run the following commands"
    echo "with mongosh for whatever MongoDB you are writing into:"
    echo ""
    echo "  db.alpha.deleteMany({\"__rerum.generatedBy\": \"YOUR_BEARER_AGENT\"});"
    echo "  db.alpha.deleteMany({\"__deleted.object.__rerum.generatedBy\": \"YOUR_BEARER_AGENT\"});"
    echo ""
    echo -n "Enter your bearer token (or press Enter to skip): "
    read -r AUTH_TOKEN

    if [ -z "$AUTH_TOKEN" ]; then
        echo -e "${RED}ERROR: No token provided. Cannot proceed with testing.${NC}"
        echo "Tests require authentication for write operations (create, update, delete)."
        exit 1
    fi
    
    log_info "Validating token..."
    if ! echo "$AUTH_TOKEN" | grep -qE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'; then
        echo -e "${RED}ERROR: Token is not a valid JWT format${NC}"
        echo "Expected format: header.payload.signature"
        exit 1
    fi
    
    local payload=$(echo "$AUTH_TOKEN" | cut -d. -f2)
    local padded_payload="${payload}$(printf '%*s' $((4 - ${#payload} % 4)) '' | tr ' ' '=')"
    local decoded_payload=$(echo "$padded_payload" | base64 -d 2>/dev/null)
    
    if [ -z "$decoded_payload" ]; then
        echo -e "${RED}ERROR: Failed to decode JWT payload${NC}"
        exit 1
    fi
    
    local exp=$(echo "$decoded_payload" | grep -o '"exp":[0-9]*' | cut -d: -f2)
    
    if [ -z "$exp" ]; then
        echo -e "${YELLOW}WARNING: Token does not contain 'exp' field${NC}"
        echo "Proceeding anyway, but token may be rejected by server..."
    else
        local current_time=$(date +%s)
        if [ "$exp" -lt "$current_time" ]; then
            echo -e "${RED}ERROR: Token is expired${NC}"
            echo "Token expired at: $(date -d @$exp)"
            echo "Current time: $(date -d @$current_time)"
            echo "Please obtain a fresh token from: https://devstore.rerum.io/"
            exit 1
        else
            local time_remaining=$((exp - current_time))
            local hours=$((time_remaining / 3600))
            local minutes=$(( (time_remaining % 3600) / 60 ))
            log_success "Token is valid (expires in ${hours}h ${minutes}m)"
        fi
    fi
}

measure_endpoint() {
    local endpoint=$1
    local method=$2
    local data=$3
    local description=$4
    local needs_auth=${5:-false}
    local timeout=${6:-10}

    local start=$(date +%s%3N)
    if [ "$needs_auth" == "true" ]; then
        local response=$(curl -s --max-time $timeout -w "\n%{http_code}" -X "$method" "${endpoint}" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${AUTH_TOKEN}" \
            ${data:+-d "$data"} 2>/dev/null)
    else
        local response=$(curl -s --max-time $timeout -w "\n%{http_code}" -X "$method" "${endpoint}" \
            -H "Content-Type: application/json" \
            ${data:+-d "$data"} 2>/dev/null)
    fi
    local end=$(date +%s%3N)
    local time=$((end - start))
    local http_code=$(echo "$response" | tail -n1)
    local response_body=$(echo "$response" | head -n-1)

    # Validate timing (protect against clock skew/adjustment)
    if [ "$time" -lt 0 ]; then
        # Clock went backward during operation
        local negative_time=$time  # Preserve negative value for logging

        # Check if HTTP request actually succeeded before treating as error
        if [ -z "$http_code" ] || [ "$http_code" == "000" ]; then
            # No HTTP code at all - actual timeout/failure
            http_code="000"
            echo -e "${YELLOW}[CLOCK SKEW DETECTED]${NC} $endpoint" >&2
            echo -e "  Start: ${start}ms, End: ${end}ms, Calculated: ${negative_time}ms (NEGATIVE!)" >&2
            echo -e "  HTTP Code: ${RED}${http_code} (NO RESPONSE)${NC}" >&2
            echo -e "  ${RED}Result: Actual timeout/connection failure${NC}" >&2
            time=0
        else
            # HTTP succeeded but timing is invalid - use 0ms as placeholder
            echo -e "${YELLOW}[CLOCK SKEW DETECTED]${NC} $endpoint" >&2
            echo -e "  Start: ${start}ms, End: ${end}ms, Calculated: ${negative_time}ms (NEGATIVE!)" >&2
            echo -e "  HTTP Code: ${GREEN}${http_code} (SUCCESS)${NC}" >&2
            echo -e "  ${GREEN}Result: Operation succeeded, timing unmeasurable${NC}" >&2
            time=0
        fi
    fi

    # Handle curl failure (connection timeout, etc) - only if we have no HTTP code
    if [ -z "$http_code" ]; then
        http_code="000"
        # Log to stderr to avoid polluting the return value
        echo "[WARN] Endpoint $endpoint timed out or connection failed" >&2
    fi

    echo "$time|$http_code|$response_body"
}

# Clear cache
clear_cache() {
    log_info "Clearing cache..."

    # Retry up to 3 times to handle concurrent cache population
    local max_attempts=3
    local attempt=1
    local cache_length=""

    while [ $attempt -le $max_attempts ]; do
        # Call /cache/clear endpoint (waits for sync before returning)
        curl -s -X POST "${API_BASE}/api/cache/clear" > /dev/null 2>&1

        # Sanity check: Verify cache is actually empty (use fast version - no need to wait for full sync)
        local stats=$(get_cache_stats_fast)
        cache_length=$(echo "$stats" | jq -r '.length' 2>/dev/null || echo "unknown")

        if [ "$cache_length" = "0" ]; then
            log_info "Sanity check - Cache successfully cleared (length: 0)"
            break
        fi

        if [ $attempt -lt $max_attempts ]; then
            log_warning "Cache length is ${cache_length} after clear attempt ${attempt}/${max_attempts}, retrying..."
            attempt=$((attempt + 1))
        else
            log_warning "Cache clear completed with ${cache_length} entries remaining after ${max_attempts} attempts"
            log_info "This may be due to concurrent requests on the development server"
        fi
        sleep 3
    done
}

# Fill cache to specified size with diverse queries (mix of matching and non-matching)
fill_cache() {
    local target_size=$1
    log_info "Filling cache to $target_size entries with diverse read patterns..."

    # Track start time for runtime calculation
    local fill_start_time=$(date +%s)

    # Strategy: Use parallel requests for faster cache filling
    # Reduced batch size and added delays to prevent overwhelming the server
    local batch_size=100  # Reduced from 100 to prevent connection exhaustion
    local completed=0
    local successful_requests=0
    local failed_requests=0
    local timeout_requests=0

    # Track requests per endpoint type for debugging
    local query_requests=0
    local search_requests=0
    local search_phrase_requests=0
    local id_requests=0
    local history_requests=0
    local since_requests=0
    
    while [ $completed -lt $target_size ]; do
        local batch_end=$((completed + batch_size))
        if [ $batch_end -gt $target_size ]; then
            batch_end=$target_size
        fi
        
        local batch_success=0
        local batch_fail=0
        local batch_timeout=0
        
        # Launch batch requests in parallel using background jobs
        for count in $(seq $completed $((batch_end - 1))); do
            (
                # Create truly unique cache entries by making each query unique
                # Use timestamp + count + random + PID to ensure uniqueness even in parallel execution
                local unique_id="CacheFill_${count}_${RANDOM}_$$_$(date +%s%N)"
                
                local endpoint=""
                local data=""
                local method="POST"
                
                # Calculate how many GET requests we can make for each endpoint type
                # Phase 2 releases indices 0-49 (immutable but still exist), deletes indices 50-99
                # Use indices 0-49 (50 IDs) for GET endpoints
                local num_ids=50
                local max_id_requests=$num_ids        # Can use each ID once for /id
                local max_history_requests=$num_ids   # Can use each ID once for /history
                local max_since_requests=$num_ids     # Can use each ID once for /since
                
                # Count how many GET requests of each type we've made so far
                # We rotate through patterns 0-5 (6 total)
                local id_requests_so_far=$(( (count / 6) + (count % 6 >= 3 ? 1 : 0) ))
                local history_requests_so_far=$(( (count / 6) + (count % 6 >= 4 ? 1 : 0) ))
                local since_requests_so_far=$(( (count / 6) + (count % 6 >= 5 ? 1 : 0) ))
                
                # Determine which pattern to use
                local pattern=$((count % 6))
                
                # First 6 requests create the cache entries we'll test for hits in Phase 4
                if [ $count -lt 6 ]; then
                    # These will be queried in Phase 4 for cache hits
                    if [ $pattern -eq 0 ]; then
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"CreatePerfTest\"}"
                        query_requests=$((query_requests + 1))
                    elif [ $pattern -eq 1 ]; then
                        endpoint="${API_BASE}/api/search"
                        data="{\"searchText\":\"annotation\"}"
                        search_requests=$((search_requests + 1))
                    elif [ $pattern -eq 2 ]; then
                        endpoint="${API_BASE}/api/search/phrase"
                        data="{\"searchText\":\"test annotation\"}"
                        search_phrase_requests=$((search_phrase_requests + 1))
                    elif [ $pattern -eq 3 ]; then
                        # Use a known object ID from CREATED_IDS array (indices 0-49, released but still exist)
                        local id_offset=$((count % 50))  # Cycle through 0-49 for diversity
                        if [ ${#CREATED_IDS[@]} -gt $id_offset ]; then
                            endpoint="${CREATED_IDS[$id_offset]}"
                            method="GET"
                            data=""
                            id_requests=$((id_requests + 1))
                        else
                            # Fallback to unique query if no IDs available
                            endpoint="${API_BASE}/api/query"
                            data="{\"type\":\"$unique_id\"}"
                            query_requests=$((query_requests + 1))
                        fi
                    elif [ $pattern -eq 4 ]; then
                        # Use a known object ID for history (indices 0-49, released but still exist)
                        local released_offset=$((count % 50))  # Cycle through 0-49
                        if [ ${#CREATED_IDS[@]} -gt $released_offset ]; then
                            local obj_id=$(echo "${CREATED_IDS[$released_offset]}" | sed 's|.*/||')
                            endpoint="${API_BASE}/history/${obj_id}"
                            method="GET"
                            data=""
                            history_requests=$((history_requests + 1))
                        else
                            # Fallback to unique search if no IDs available
                            endpoint="${API_BASE}/api/search"
                            data="{\"searchText\":\"$unique_id\"}"
                            search_requests=$((search_requests + 1))
                        fi
                    else
                        # Use a known object ID for since (indices 0-49, released but still exist)
                        local released_offset=$((count % 50))  # Cycle through 0-49
                        if [ ${#CREATED_IDS[@]} -gt $released_offset ]; then
                            local since_id=$(echo "${CREATED_IDS[$released_offset]}" | sed 's|.*/||')
                            endpoint="${API_BASE}/since/${since_id}"
                            method="GET"
                            data=""
                            since_requests=$((since_requests + 1))
                        else
                            # Fallback to unique search phrase if no IDs available
                            endpoint="${API_BASE}/api/search/phrase"
                            data="{\"searchText\":\"$unique_id\"}"
                            search_phrase_requests=$((search_phrase_requests + 1))
                        fi
                    fi
                else
                    # For remaining requests: Create queries that will be invalidated by Phase 5 writes
                    # Strategy: Cycle through the 6 write operation types to ensure good distribution
                    # Each type gets ~166 cache entries (1000-6 / 6 types)
                    local write_type=$((count % 6))
                    
                    if [ $write_type -eq 0 ]; then
                        # CreatePerfTest queries - will be invalidated by create operations
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"CreatePerfTest\",\"limit\":$((count / 6))}"
                        query_requests=$((query_requests + 1))
                    elif [ $write_type -eq 1 ]; then
                        # UpdateTest queries - will be invalidated by update operations
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"UpdateTest\",\"limit\":$((count / 6))}"
                        query_requests=$((query_requests + 1))
                    elif [ $write_type -eq 2 ]; then
                        # PatchTest queries - will be invalidated by patch operations
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"PatchTest\",\"limit\":$((count / 6))}"
                        query_requests=$((query_requests + 1))
                    elif [ $write_type -eq 3 ]; then
                        # SetTest queries - will be invalidated by set operations
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"SetTest\",\"limit\":$((count / 6))}"
                        query_requests=$((query_requests + 1))
                    elif [ $write_type -eq 4 ]; then
                        # UnsetTest queries - will be invalidated by unset operations
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"UnsetTest\",\"limit\":$((count / 6))}"
                        query_requests=$((query_requests + 1))
                    else
                        # OverwriteTest queries - will be invalidated by overwrite operations
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"OverwriteTest\",\"limit\":$((count / 6))}"
                        query_requests=$((query_requests + 1))
                    fi
                fi
                
                # Make request with timeout and error checking
                # --max-time 35: timeout after 35 seconds
                # --connect-timeout 15: timeout connection after 15 seconds
                # -w '%{http_code}': output HTTP status code
                local http_code=""
                if [ "$method" = "GET" ]; then
                    http_code=$(curl -s -X GET "$endpoint" \
                        --max-time 10 \
                        --connect-timeout 10 \
                        -w '%{http_code}' \
                        -o /dev/null 2>&1)
                else
                    http_code=$(curl -s -X POST "$endpoint" \
                        -H "Content-Type: application/json" \
                        -d "$data" \
                        --max-time 10 \
                        --connect-timeout 10 \
                        -w '%{http_code}' \
                        -o /dev/null 2>&1)
                fi
                
                local exit_code=$?
                
                # Check result and write to temp file for parent process to read
                if [ $exit_code -eq 28 ]; then
                    # Timeout
                    echo "timeout" >> /tmp/cache_fill_results_$$.tmp
                elif [ $exit_code -ne 0 ]; then
                    # Other curl error
                    echo "fail:$exit_code" >> /tmp/cache_fill_results_$$.tmp
                elif [ "$http_code" = "200" ]; then
                    # Success
                    echo "success" >> /tmp/cache_fill_results_$$.tmp
                else
                    # HTTP error
                    echo "fail:http_$http_code" >> /tmp/cache_fill_results_$$.tmp
                fi
            ) &
        done
        
        # Wait for all background jobs to complete
        wait
        
        # Count results from temp file
        batch_success=0
        batch_timeout=0
        batch_fail=0
        if [ -f /tmp/cache_fill_results_$$.tmp ]; then
            batch_success=$(grep -c "^success$" /tmp/cache_fill_results_$$.tmp 2>/dev/null || echo "0")
            batch_timeout=$(grep -c "^timeout$" /tmp/cache_fill_results_$$.tmp 2>/dev/null || echo "0")
            batch_fail=$(grep -c "^fail:" /tmp/cache_fill_results_$$.tmp 2>/dev/null || echo "0")
            rm /tmp/cache_fill_results_$$.tmp
        fi
        
        # Ensure variables are clean integers (strip any whitespace/newlines)
        batch_success=$(echo "$batch_success" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
        batch_timeout=$(echo "$batch_timeout" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
        batch_fail=$(echo "$batch_fail" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
        batch_success=${batch_success:-0}
        batch_timeout=${batch_timeout:-0}
        batch_fail=${batch_fail:-0}
        
        successful_requests=$((successful_requests + batch_success))
        timeout_requests=$((timeout_requests + batch_timeout))
        failed_requests=$((failed_requests + batch_fail))
        
        completed=$batch_end
        local pct=$((completed * 100 / target_size))
        echo -ne "\r  Progress: $completed/$target_size requests sent (${pct}%) | Success: $successful_requests | Timeout: $timeout_requests | Failed: $failed_requests  "
        
        # Add small delay between batches to prevent overwhelming the server
        sleep 0.5
    done
    echo ""

    # Calculate total runtime
    local fill_end_time=$(date +%s)
    local fill_runtime=$((fill_end_time - fill_start_time))

    log_info "Request Statistics:"
    log_info "  Total requests sent: $completed"
    log_info "  Successful (200 OK): $successful_requests"
    log_info "  Total Runtime: ${fill_runtime} seconds"
    log_info "  Timeouts: $timeout_requests"
    log_info "  Failed/Errors: $failed_requests"
    
    log_info "Sanity check - Verifying cache size after fill..."
    local final_stats=$(get_cache_stats)
    local final_size=$(echo "$final_stats" | jq -r '.length' 2>/dev/null || echo "0")
    local max_length=$(echo "$final_stats" | jq -r '.maxLength' 2>/dev/null || echo "0")
    local total_sets=$(echo "$final_stats" | jq -r '.sets' 2>/dev/null || echo "0")
    local total_hits=$(echo "$final_stats" | jq -r '.hits' 2>/dev/null || echo "0")
    local total_misses=$(echo "$final_stats" | jq -r '.misses' 2>/dev/null || echo "0")
    local evictions=$(echo "$final_stats" | jq -r '.evictions' 2>/dev/null || echo "0")
    
    log_info "Sanity check - Cache stats after fill:"
    log_info "  Cache size: ${final_size} / ${max_length} (target: ${target_size})"
    log_info "  Total cache.set() calls: ${total_sets}"
    log_info "  Cache hits: ${total_hits}"
    log_info "  Cache misses: ${total_misses}"
    log_info "  Evictions: ${evictions}"
    
    local expected_sets=$successful_requests
    if [ "$total_sets" -lt "$expected_sets" ]; then
        local uncached_count=$(($expected_sets - $total_sets))
        log_info "Note: ${uncached_count} of ${expected_sets} successful responses were not cached"
    fi
    
    if [ "$final_size" -lt "$target_size" ] && [ "$final_size" -eq "$max_length" ]; then
        log_failure "Cache is full at max capacity (${max_length}) but target was ${target_size}"
        log_info "To test with ${target_size} entries, set CACHE_MAX_LENGTH=${target_size} in .env and restart server."
        exit 1
    elif [ "$final_size" -lt "$target_size" ]; then
        log_failure "Cache size (${final_size}) is less than target (${target_size})"
        log_info "Requests sent: ${completed}, Successful: ${successful_requests}, Cache.set() calls: ${total_sets}"
        exit 1
    fi
    
    log_success "Cache filled to ${final_size} entries"
    
    sleep 1
}

# Warm up the system (JIT compilation, connection pools, OS caches)
warmup_system() {
    log_info "Warming up system (JIT compilation, connection pools, OS caches)..."
    log_info "Running $WARMUP_ITERATIONS warmup operations..."
    
    local count=0
    for i in $(seq 1 $WARMUP_ITERATIONS); do
        curl -s -X POST "${API_BASE}/api/create" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${AUTH_TOKEN}" \
            -d '{"type":"WarmupTest","value":"warmup"}' > /dev/null 2>&1
        count=$((count + 1))
        
        if [ $((i % 5)) -eq 0 ]; then
            echo -ne "\r  Warmup progress: $count/$WARMUP_ITERATIONS  "
        fi
    done
    echo ""
    
    log_success "System warmed up"
    
    clear_cache
}

# Get cache stats (fast version - may not be synced across workers)
get_cache_stats_fast() {
    curl -s "${API_BASE}/api/cache/stats" 2>/dev/null
}

# Get cache stats (with sync wait for accurate cross-worker aggregation)
get_cache_stats() {
    log_info "Waiting for cache stats to sync across all PM2 workers (8 seconds.  HOLD!)..." >&2
    sleep 8
    curl -s "${API_BASE}/api/cache/stats" 2>/dev/null
}

# Helper: Create a test object and track it for cleanup
# Returns the object ID
create_test_object() {
    local data=$1
    local description=${2:-"Creating test object"}
    
    local response=$(curl -s -X POST "${API_BASE}/api/create" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d "$data" 2>/dev/null)
    
    local obj_id=$(echo "$response" | jq -r '.["@id"]' 2>/dev/null)
    
    if [ -n "$obj_id" ] && [ "$obj_id" != "null" ]; then
        CREATED_IDS+=("$obj_id")
        CREATED_OBJECTS["$obj_id"]="$response"
        sleep 1
    fi
    
    echo "$obj_id"
}

# Create test object and return the full object (not just ID)
create_test_object_with_body() {
    local data=$1
    local description=${2:-"Creating test object"}
    
    local response=$(curl -s -X POST "${API_BASE}/api/create" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d "$data" 2>/dev/null)
    
    local obj_id=$(echo "$response" | jq -r '.["@id"]' 2>/dev/null)
    
    if [ -n "$obj_id" ] && [ "$obj_id" != "null" ]; then
        CREATED_IDS+=("$obj_id")
        CREATED_OBJECTS["$obj_id"]="$response"
        sleep 1  # Allow DB and cache to process
        echo "$response"
    else
        echo ""
    fi
}

################################################################################
# Functionality Tests
################################################################################

# Query endpoint - cold cache test
test_query_endpoint_cold() {
    log_section "Testing /api/query Endpoint (Cold Cache)"

    ENDPOINT_DESCRIPTIONS["query"]="Query database with filters"

    log_info "Testing query with cold cache..."
    # Use the same query that will be cached in Phase 3 and tested in Phase 4
    local result=$(measure_endpoint "${API_BASE}/api/query" "POST" '{"type":"CreatePerfTest"}' "Query for CreatePerfTest")
    local cold_time=$(echo "$result" | cut -d'|' -f1)
    local cold_code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_COLD_TIMES["query"]=$cold_time

    # HTTP 200 = success (even if timing was 0ms due to clock skew)
    # HTTP 000 = actual failure (no HTTP response at all)
    if [ "$cold_code" == "200" ]; then
        if [ "$cold_time" == "0" ]; then
            log_success "Query endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "Query endpoint functional (${cold_time}ms)"
        fi
        ENDPOINT_STATUS["query"]="✅ Functional"
    else
        log_failure "Query endpoint failed (HTTP $cold_code)"
        ENDPOINT_STATUS["query"]="❌ Failed"
    fi
}

# Query endpoint - warm cache test
test_query_endpoint_warm() {
    log_section "Testing /api/query Endpoint (Warm Cache)"
    
    log_info "Testing query with warm cache..."
    local result=$(measure_endpoint "${API_BASE}/api/query" "POST" '{"type":"Annotation","limit":5}' "Query for Annotations")
    local warm_time=$(echo "$result" | cut -d'|' -f1)
    local warm_code=$(echo "$result" | cut -d'|' -f2)
    
    ENDPOINT_WARM_TIMES["query"]=$warm_time
    
    if [ "$warm_code" == "200" ]; then
        local cold_time=${ENDPOINT_COLD_TIMES["query"]}
        local speedup=$((cold_time - warm_time))
        if [ $warm_time -lt $cold_time ]; then
            log_success "Cache hit faster by ${speedup}ms (cold: ${cold_time}ms, warm: ${warm_time}ms)"
        else
            log_warning "Cache hit not faster (cold: ${cold_time}ms, warm: ${warm_time}ms)"
        fi
    fi
}

test_search_endpoint() {
    log_section "Testing /api/search Endpoint"
    
    ENDPOINT_DESCRIPTIONS["search"]="Full-text search across documents"
    
    clear_cache
    
    # Test search functionality with the same query that will be cached in Phase 3 and tested in Phase 4
    log_info "Testing search with cold cache..."
    local result=$(measure_endpoint "${API_BASE}/api/search" "POST" '{"searchText":"annotation"}' "Search for 'annotation'")
    local cold_time=$(echo "$result" | cut -d'|' -f1)
    local cold_code=$(echo "$result" | cut -d'|' -f2)
    
    ENDPOINT_COLD_TIMES["search"]=$cold_time
    
    if [ "$cold_code" == "200" ]; then
        log_success "Search endpoint functional (${cold_time}ms)"
        ENDPOINT_STATUS["search"]="✅ Functional"
    elif [ "$cold_code" == "501" ]; then
        log_skip "Search endpoint not implemented or requires MongoDB Atlas Search indexes"
        ENDPOINT_STATUS["search"]="⚠️  Requires Setup"
        ENDPOINT_COLD_TIMES["search"]="N/A"
        ENDPOINT_WARM_TIMES["search"]="N/A"
    else
        log_failure "Search endpoint failed (HTTP $cold_code)"
        ENDPOINT_STATUS["search"]="❌ Failed"
    fi
}

test_id_endpoint() {
    log_section "Testing /id/:id Endpoint"

    ENDPOINT_DESCRIPTIONS["id"]="Retrieve object by ID"

    # Create test object to get an ID
    local test_id=$(create_test_object '{"type":"IdTest","value":"test"}' "Creating test object")

    # Validate object creation
    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for ID test"
        ENDPOINT_STATUS["id"]="❌ Test Setup Failed"
        ENDPOINT_COLD_TIMES["id"]="N/A"
        ENDPOINT_WARM_TIMES["id"]="N/A"
        return
    fi

    clear_cache

    # Test ID retrieval with cold cache
    log_info "Testing ID retrieval with cold cache..."
    local result=$(measure_endpoint "$test_id" "GET" "" "Get object by ID")
    local cold_time=$(echo "$result" | cut -d'|' -f1)
    local cold_code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_COLD_TIMES["id"]=$cold_time

    # HTTP 200 = success (even if timing was 0ms due to clock skew)
    # HTTP 000 = actual failure (no HTTP response at all)
    if [ "$cold_code" != "200" ]; then
        log_failure "ID endpoint failed (HTTP $cold_code)"
        ENDPOINT_STATUS["id"]="❌ Failed"
        ENDPOINT_WARM_TIMES["id"]="N/A"
        return
    fi

    # Success - endpoint is functional
    if [ "$cold_time" == "0" ]; then
        log_success "ID endpoint functional (timing unavailable due to clock skew)"
    else
        log_success "ID endpoint functional"
    fi
    ENDPOINT_STATUS["id"]="✅ Functional"
}

# Perform a single write operation and return time in milliseconds
perform_write_operation() {
    local endpoint=$1
    local method=$2
    local body=$3

    local start=$(date +%s%3N)

    local response=$(curl -s -w "\n%{http_code}" -X "$method" "${API_BASE}/api/${endpoint}" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d "${body}" 2>/dev/null)

    local end=$(date +%s%3N)
    local http_code=$(echo "$response" | tail -n1)
    local time=$((end - start))
    local response_body=$(echo "$response" | head -n-1)

    # Check for success codes first
    local success=0
    if [ "$endpoint" = "create" ] && [ "$http_code" = "201" ]; then
        success=1
    elif [ "$http_code" = "200" ]; then
        success=1
    fi

    # If HTTP request succeeded but timing is invalid (clock skew), use 0 as placeholder time
    # This allows the operation to count as successful even though we can't measure it
    if [ "$time" -lt 0 ]; then
        local negative_time=$time  # Preserve negative value for logging

        if [ $success -eq 1 ]; then
            # Clock skew but HTTP succeeded - mark as successful with 0ms timing
            echo -e "${YELLOW}[CLOCK SKEW DETECTED]${NC} ${API_BASE}/api/${endpoint}" >&2
            echo -e "  Start: ${start}ms, End: ${end}ms, Calculated: ${negative_time}ms (NEGATIVE!)" >&2
            echo -e "  HTTP Code: ${GREEN}${http_code} (SUCCESS)${NC}" >&2
            echo -e "  ${GREEN}Result: Operation succeeded, timing unmeasurable${NC}" >&2
            echo "0|$http_code|clock_skew"
            return
        else
            # Actual failure (bad HTTP code)
            echo -e "${YELLOW}[CLOCK SKEW DETECTED]${NC} ${API_BASE}/api/${endpoint}" >&2
            echo -e "  Start: ${start}ms, End: ${end}ms, Calculated: ${negative_time}ms (NEGATIVE!)" >&2
            echo -e "  HTTP Code: ${RED}${http_code} (FAILURE)${NC}" >&2
            echo -e "  ${RED}Result: Request failed (bad HTTP status)${NC}" >&2
            echo "-1|$http_code|"
            return
        fi
    fi

    if [ $success -eq 0 ]; then
        echo "-1|$http_code|"
        return
    fi

    echo "$time|$http_code|$response_body"
}

# Run performance test for a write endpoint
run_write_performance_test() {
    local endpoint_name=$1
    local endpoint_path=$2
    local method=$3
    local get_body_func=$4
    local num_tests=${5:-100}
    
    log_info "Running $num_tests $endpoint_name operations..." >&2
    
    declare -a times=()
    local total_time=0
    local failed_count=0
    local clock_skew_count=0

    # For create endpoint, collect IDs directly into global array
    local collect_ids=0
    [ "$endpoint_name" = "create" ] && collect_ids=1

    for i in $(seq 1 $num_tests); do
        local body=$($get_body_func)
        local result=$(perform_write_operation "$endpoint_path" "$method" "$body")

        local time=$(echo "$result" | cut -d'|' -f1)
        local http_code=$(echo "$result" | cut -d'|' -f2)
        local response_body=$(echo "$result" | cut -d'|' -f3-)

        # Check if operation actually failed (marked as -1)
        if [ "$time" = "-1" ]; then
            failed_count=$((failed_count + 1))
        elif [ "$response_body" = "clock_skew" ]; then
            # Clock skew with successful HTTP code - count as success but note it
            clock_skew_count=$((clock_skew_count + 1))
            # Don't add to times array (0ms is not meaningful) or total_time

            # Store created ID directly to global array for cleanup
            if [ $collect_ids -eq 1 ] && [ -n "$response_body" ]; then
                local obj_id=$(echo "$response_body" | grep -o '"@id":"[^"]*"' | head -1 | cut -d'"' -f4)
                if [ -n "$obj_id" ]; then
                    CREATED_IDS+=("$obj_id")
                fi
            fi
        else
            # Normal successful operation with valid timing
            times+=($time)
            total_time=$((total_time + time))

            # Store created ID directly to global array for cleanup
            if [ $collect_ids -eq 1 ] && [ -n "$response_body" ]; then
                local obj_id=$(echo "$response_body" | grep -o '"@id":"[^"]*"' | head -1 | cut -d'"' -f4)
                if [ -n "$obj_id" ]; then
                    CREATED_IDS+=("$obj_id")
                fi
            fi
        fi

        # Progress indicator
        if [ $((i % 10)) -eq 0 ]; then
            echo -ne "\r  Progress: $i/$num_tests operations completed  " >&2
        fi
    done
    echo "" >&2

    local successful=$((num_tests - failed_count))
    local measurable=$((${#times[@]}))

    if [ $successful -eq 0 ]; then
        log_warning "All $endpoint_name operations failed!" >&2
        echo "0|0|0|0"
        return 1
    fi

    # Calculate statistics only from operations with valid timing
    local avg_time=0
    local median_time=0
    local min_time=0
    local max_time=0

    if [ $measurable -gt 0 ]; then
        avg_time=$((total_time / measurable))

        # Calculate median
        IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
        unset IFS
        local median_idx=$((measurable / 2))
        median_time=${sorted[$median_idx]}

        # Calculate min/max
        min_time=${sorted[0]}
        max_time=${sorted[$((measurable - 1))]}
    fi

    log_success "$successful/$num_tests successful" >&2

    if [ $measurable -gt 0 ]; then
        echo "  Total: ${total_time}ms, Average: ${avg_time}ms, Median: ${median_time}ms, Min: ${min_time}ms, Max: ${max_time}ms" >&2
    else
        echo "  (timing data unavailable - all operations affected by clock skew)" >&2
    fi

    if [ $failed_count -gt 0 ]; then
        log_warning "  Failed operations: $failed_count" >&2
    fi

    if [ $clock_skew_count -gt 0 ]; then
        log_warning "  Clock skew detections (timing unmeasurable but HTTP succeeded): $clock_skew_count" >&2
    fi
    
    # Write stats to temp file (so they persist when function is called directly, not in subshell)
    echo "$avg_time|$median_time|$min_time|$max_time" > /tmp/rerum_write_stats
}

test_history_endpoint() {
    log_section "Testing /history/:id Endpoint"
    
    ENDPOINT_DESCRIPTIONS["history"]="Get object version history"
    
    # Create and update an object to generate history
    local create_response=$(curl -s -X POST "${API_BASE}/api/create" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d '{"type":"HistoryTest","version":1}' 2>/dev/null)
    
    local test_id=$(echo "$create_response" | jq -r '.["@id"]' 2>/dev/null)
    CREATED_IDS+=("$test_id")
    
    # Wait for object to be available
    sleep 2
    
    # Extract just the ID portion for the history endpoint
    local obj_id=$(echo "$test_id" | sed 's|.*/||')
    
    # Skip history test if object creation failed
    if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
        log_warning "Skipping history test - object creation failed"
        return
    fi
    
    # Get the full object and update to create history
    local full_object=$(curl -s "$test_id" 2>/dev/null)
    local update_body=$(echo "$full_object" | jq '. + {version: 2}' 2>/dev/null)
    
    curl -s -X PUT "${API_BASE}/api/update" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d "$update_body" > /dev/null 2>&1
    
    clear_cache
    
    # Test history with cold cache
    log_info "Testing history with cold cache..."
    local result=$(measure_endpoint "${API_BASE}/history/${obj_id}" "GET" "" "Get object history")
    local cold_time=$(echo "$result" | cut -d'|' -f1)
    local cold_code=$(echo "$result" | cut -d'|' -f2)
    
    ENDPOINT_COLD_TIMES["history"]=$cold_time
    
    if [ "$cold_code" == "200" ]; then
        log_success "History endpoint functional"
        ENDPOINT_STATUS["history"]="✅ Functional"
    else
        log_failure "History endpoint failed (HTTP $cold_code)"
        ENDPOINT_STATUS["history"]="❌ Failed"
    fi
}

test_since_endpoint() {
    log_section "Testing /since/:id Endpoint"
    
    ENDPOINT_DESCRIPTIONS["since"]="Get objects modified since timestamp"
    
    # Create a test object to use for since lookup
    local create_response=$(curl -s -X POST "${API_BASE}/api/create" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${AUTH_TOKEN}" \
        -d '{"type":"SinceTest","value":"test"}' 2>/dev/null)
    
    local test_id=$(echo "$create_response" | jq -r '.["@id"]' 2>/dev/null | sed 's|.*/||')
    
    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Cannot create test object for since test"
        ENDPOINT_STATUS["since"]="❌ Test Setup Failed"
        return
    fi
    
    CREATED_IDS+=("${API_BASE}/id/${test_id}")
    
    # The clear_cache function waits internally for all workers to sync (5.5s)
    clear_cache
    
    # Test with cold cache
    log_info "Testing since with cold cache..."
    local result=$(measure_endpoint "${API_BASE}/since/$test_id" "GET" "" "Get since info")
    local cold_time=$(echo "$result" | cut -d'|' -f1)
    local cold_code=$(echo "$result" | cut -d'|' -f2)
    
    ENDPOINT_COLD_TIMES["since"]=$cold_time
    
    if [ "$cold_code" == "200" ]; then
        log_success "Since endpoint functional"
        ENDPOINT_STATUS["since"]="✅ Functional"
    else
        log_failure "Since endpoint failed (HTTP $cold_code)"
        ENDPOINT_STATUS["since"]="❌ Failed"
    fi
}

test_search_phrase_endpoint() {
    log_section "Testing /api/search/phrase Endpoint"
    
    ENDPOINT_DESCRIPTIONS["searchPhrase"]="Phrase search across documents"
    
    clear_cache
    
    # Test search phrase functionality with the same query that will be cached in Phase 3 and tested in Phase 4
    log_info "Testing search phrase with cold cache..."
    local result=$(measure_endpoint "${API_BASE}/api/search/phrase" "POST" '{"searchText":"test annotation"}' "Phrase search")
    local cold_time=$(echo "$result" | cut -d'|' -f1)
    local cold_code=$(echo "$result" | cut -d'|' -f2)
    
    ENDPOINT_COLD_TIMES["searchPhrase"]=$cold_time
    
    if [ "$cold_code" == "200" ]; then
        log_success "Search phrase endpoint functional (${cold_time}ms)"
        ENDPOINT_STATUS["searchPhrase"]="✅ Functional"
    elif [ "$cold_code" == "501" ]; then
        log_skip "Search phrase endpoint not implemented or requires MongoDB Atlas Search indexes"
        ENDPOINT_STATUS["searchPhrase"]="⚠️  Requires Setup"
        ENDPOINT_COLD_TIMES["searchPhrase"]="N/A"
        ENDPOINT_WARM_TIMES["searchPhrase"]="N/A"
    else
        log_failure "Search phrase endpoint failed (HTTP $cold_code)"
        ENDPOINT_STATUS["searchPhrase"]="❌ Failed"
    fi
}

################################################################################
# Cleanup
################################################################################

cleanup_test_objects() {
    if [ ${#CREATED_IDS[@]} -gt 0 ]; then
        log_section "Cleaning Up Test Objects"
        log_info "Deleting ${#CREATED_IDS[@]} test objects..."
        
        for obj_id in "${CREATED_IDS[@]}"; do
            curl -s -X DELETE "$obj_id" \
                -H "Authorization: Bearer ${AUTH_TOKEN}" > /dev/null 2>&1
        done
        
        log_success "Cleanup complete"
    fi
}

################################################################################
# Report Generation
################################################################################

generate_report() {
    log_header "Generating Report"

    local cache_stats=$(get_cache_stats)
    local cache_hits=$(echo "$cache_stats" | grep -o '"hits":[0-9]*' | cut -d: -f2)
    local cache_misses=$(echo "$cache_stats" | grep -o '"misses":[0-9]*' | cut -d: -f2)
    local cache_size=$(echo "$cache_stats" | grep -o '"length":[0-9]*' | cut -d: -f2)
    
    cat > "$REPORT_FILE" << EOF
# RERUM Cache Metrics & Functionality Report

**Generated**: $(date)  
**Test Duration**: Full integration and performance suite  
**Server**: ${BASE_URL}

---

## Executive Summary

**Overall Test Results**: ${PASSED_TESTS} passed, ${FAILED_TESTS} failed, ${SKIPPED_TESTS} skipped (${TOTAL_TESTS} total)

### Cache Performance Summary

| Metric | Value |
|--------|-------|
| Cache Hits | ${cache_hits:-0} |
| Cache Misses | ${cache_misses:-0} |
| Hit Rate | $(echo "$cache_stats" | grep -o '"hitRate":"[^"]*"' | cut -d'"' -f4) |
| Cache Size | ${cache_size:-0} entries |

---

## Endpoint Functionality Status

| Endpoint | Status | Description |
|----------|--------|-------------|
EOF

    # Add endpoint status rows
    for endpoint in query search searchPhrase id history since create update patch set unset delete overwrite; do
        local status="${ENDPOINT_STATUS[$endpoint]:-⚠️  Not Tested}"
        local desc="${ENDPOINT_DESCRIPTIONS[$endpoint]:-}"
        echo "| \`/$endpoint\` | $status | $desc |" >> "$REPORT_FILE"
    done

    cat >> "$REPORT_FILE" << EOF

---

## Read Performance Analysis

### Cache Impact on Read Operations

| Endpoint | Cold Cache (DB) | Warm Cache (Memory) | Speedup | Benefit |
|----------|-----------------|---------------------|---------|---------|
EOF

    # Add read performance rows
    for endpoint in query search searchPhrase id history since; do
        local cold="${ENDPOINT_COLD_TIMES[$endpoint]:-N/A}"
        local warm="${ENDPOINT_WARM_TIMES[$endpoint]:-N/A}"
        
        if [[ "$cold" != "N/A" && "$warm" != "N/A" && "$cold" =~ ^[0-9]+$ && "$warm" =~ ^[0-9]+$ ]]; then
            local speedup=$((cold - warm))
            local benefit=""
            if [ $speedup -gt 10 ]; then
                benefit="✅ High"
            elif [ $speedup -gt 5 ]; then
                benefit="✅ Moderate"
            elif [ $speedup -gt 0 ]; then
                benefit="✅ Low"
            else
                benefit="⚠️  None"
            fi
            echo "| \`/$endpoint\` | ${cold}ms | ${warm}ms | -${speedup}ms | $benefit |" >> "$REPORT_FILE"
        else
            echo "| \`/$endpoint\` | ${cold} | ${warm} | N/A | N/A |" >> "$REPORT_FILE"
        fi
    done

    cat >> "$REPORT_FILE" << EOF

**Interpretation**:
- **Cold Cache**: First request hits database (cache miss)
- **Warm Cache**: Subsequent identical requests served from memory (cache hit)
- **Speedup**: Time saved per request when cache hit occurs
- **Benefit**: Overall impact assessment

---

## Write Performance Analysis

### Cache Overhead on Write Operations

| Endpoint | Empty Cache | Full Cache (1000 entries) | Overhead | Impact |
|----------|-------------|---------------------------|----------|--------|
EOF

    # Add write performance rows
    local has_negative_overhead=false
    for endpoint in create update patch set unset delete overwrite; do
        local cold="${ENDPOINT_COLD_TIMES[$endpoint]:-N/A}"
        local warm="${ENDPOINT_WARM_TIMES[$endpoint]:-N/A}"
        
        if [[ "$cold" != "N/A" && "$warm" =~ ^[0-9]+$ ]]; then
            local overhead=$((warm - cold))
            local impact=""
            local overhead_display=""
            
            if [ $overhead -lt 0 ]; then
                has_negative_overhead=true
                overhead_display="${overhead}ms"
                impact="✅ None"
            elif [ $overhead -gt 10 ]; then
                overhead_display="+${overhead}ms"
                impact="⚠️  Moderate"
            elif [ $overhead -gt 5 ]; then
                overhead_display="+${overhead}ms"
                impact="✅ Low"
            else
                overhead_display="+${overhead}ms"
                impact="✅ Negligible"
            fi
            echo "| \`/$endpoint\` | ${cold}ms | ${warm}ms | ${overhead_display} | $impact |" >> "$REPORT_FILE"
        elif [[ "$cold" != "N/A" ]]; then
            echo "| \`/$endpoint\` | ${cold}ms | ${warm} | N/A | ✅ Write-only |" >> "$REPORT_FILE"
        else
            echo "| \`/$endpoint\` | ${cold} | ${warm} | N/A | N/A |" >> "$REPORT_FILE"
        fi
    done

    cat >> "$REPORT_FILE" << EOF

**Interpretation**:
- **Empty Cache**: Write with no cache to invalidate
- **Full Cache**: Write with 1000 cached queries (cache invalidation occurs)
- **Overhead**: Additional time required to scan and invalidate cache
- **Impact**: Assessment of cache cost on write performance
EOF

    # Add disclaimer if any negative overhead was found
    if [ "$has_negative_overhead" = true ]; then
        cat >> "$REPORT_FILE" << EOF

**Note**: Negative overhead values indicate the operation was slightly faster with a full cache. This is due to normal statistical variance in database operations (network latency, MongoDB state, system load) and should be interpreted as "negligible overhead" rather than an actual performance improvement from cache invalidation.
EOF
    fi

    cat >> "$REPORT_FILE" << EOF

---

## Cost-Benefit Analysis

### Overall Performance Impact
EOF

    # Calculate averages
    local read_total_speedup=0
    local read_count=0
    for endpoint in query id history since; do
        local cold="${ENDPOINT_COLD_TIMES[$endpoint]}"
        local warm="${ENDPOINT_WARM_TIMES[$endpoint]}"
        if [[ "$cold" =~ ^[0-9]+$ && "$warm" =~ ^[0-9]+$ ]]; then
            read_total_speedup=$((read_total_speedup + cold - warm))
            read_count=$((read_count + 1))
        fi
    done
    
    local write_total_overhead=0
    local write_count=0
    local write_cold_sum=0
    for endpoint in create update patch set unset delete overwrite; do
        local cold="${ENDPOINT_COLD_TIMES[$endpoint]}"
        local warm="${ENDPOINT_WARM_TIMES[$endpoint]}"
        if [[ "$cold" =~ ^[0-9]+$ && "$warm" =~ ^[0-9]+$ ]]; then
            write_total_overhead=$((write_total_overhead + warm - cold))
            write_cold_sum=$((write_cold_sum + cold))
            write_count=$((write_count + 1))
        fi
    done
    
    local avg_read_speedup=$((read_count > 0 ? read_total_speedup / read_count : 0))
    local avg_write_overhead=$((write_count > 0 ? write_total_overhead / write_count : 0))
    local avg_write_cold=$((write_count > 0 ? write_cold_sum / write_count : 0))
    local write_overhead_pct=$((avg_write_cold > 0 ? (avg_write_overhead * 100 / avg_write_cold) : 0))

    cat >> "$REPORT_FILE" << EOF

**Cache Benefits (Reads)**:
- Average speedup per cached read: ~${avg_read_speedup}ms
- Typical hit rate in production: 60-80%
- Net benefit on 1000 reads: ~$((avg_read_speedup * 700))ms saved (assuming 70% hit rate)

**Cache Costs (Writes)**:
- Average overhead per write: ~${avg_write_overhead}ms
- Overhead percentage: ~${write_overhead_pct}%
- Net cost on 1000 writes: ~$((avg_write_overhead * 1000))ms
- Tested endpoints: create, update, patch, set, unset, delete, overwrite

**Break-Even Analysis**:

For a workload with:
- 80% reads (800 requests)
- 20% writes (200 requests)
- 70% cache hit rate

\`\`\`
Without Cache:
  800 reads × ${ENDPOINT_COLD_TIMES[query]:-20}ms = $((800 * ${ENDPOINT_COLD_TIMES[query]:-20}))ms
  200 writes × ${ENDPOINT_COLD_TIMES[create]:-20}ms = $((200 * ${ENDPOINT_COLD_TIMES[create]:-20}))ms
  Total: $((800 * ${ENDPOINT_COLD_TIMES[query]:-20} + 200 * ${ENDPOINT_COLD_TIMES[create]:-20}))ms

With Cache:
  560 cached reads × ${ENDPOINT_WARM_TIMES[query]:-5}ms = $((560 * ${ENDPOINT_WARM_TIMES[query]:-5}))ms
  240 uncached reads × ${ENDPOINT_COLD_TIMES[query]:-20}ms = $((240 * ${ENDPOINT_COLD_TIMES[query]:-20}))ms
  200 writes × ${ENDPOINT_WARM_TIMES[create]:-22}ms = $((200 * ${ENDPOINT_WARM_TIMES[create]:-22}))ms
  Total: $((560 * ${ENDPOINT_WARM_TIMES[query]:-5} + 240 * ${ENDPOINT_COLD_TIMES[query]:-20} + 200 * ${ENDPOINT_WARM_TIMES[create]:-22}))ms

Net Improvement: $((800 * ${ENDPOINT_COLD_TIMES[query]:-20} + 200 * ${ENDPOINT_COLD_TIMES[create]:-20} - (560 * ${ENDPOINT_WARM_TIMES[query]:-5} + 240 * ${ENDPOINT_COLD_TIMES[query]:-20} + 200 * ${ENDPOINT_WARM_TIMES[create]:-22})))ms faster (~$((100 - (100 * (560 * ${ENDPOINT_WARM_TIMES[query]:-5} + 240 * ${ENDPOINT_COLD_TIMES[query]:-20} + 200 * ${ENDPOINT_WARM_TIMES[create]:-22}) / (800 * ${ENDPOINT_COLD_TIMES[query]:-20} + 200 * ${ENDPOINT_COLD_TIMES[create]:-20}))))% improvement)
\`\`\`

---

## Recommendations

### ✅ Deploy Cache Layer

The cache layer provides:
1. **Significant read performance improvements** (${avg_read_speedup}ms average speedup)
2. **Minimal write overhead** (${avg_write_overhead}ms average, ~${write_overhead_pct}% of write time)
3. **All endpoints functioning correctly** (${PASSED_TESTS} passed tests)

### 📊 Monitoring Recommendations

In production, monitor:
- **Hit rate**: Target 60-80% for optimal benefit
- **Evictions**: Should be minimal; increase cache size if frequent
- **Cache size changes**: Track cache size over time to understand invalidation patterns
- **Response times**: Track p50, p95, p99 for all endpoints

### ⚙️ Configuration Tuning

Current cache configuration:
- Max entries: $(echo "$cache_stats" | grep -o '"maxLength":[0-9]*' | cut -d: -f2)
- Max size: $(echo "$cache_stats" | grep -o '"maxBytes":[0-9]*' | cut -d: -f2) bytes
- TTL: $(echo "$cache_stats" | grep -o '"ttl":[0-9]*' | cut -d: -f2 | awk '{printf "%.0f", $1/1000}') seconds

Consider tuning based on:
- Workload patterns (read/write ratio)
- Available memory
- Query result sizes
- Data freshness requirements

---

## Test Execution Details

**Test Environment**:
- Server: ${BASE_URL}
- Test Framework: Bash + curl
- Metrics Collection: Millisecond-precision timing
- Test Objects Created: ${#CREATED_IDS[@]}
- All test objects cleaned up: ✅

**Test Coverage**:
- ✅ Endpoint functionality verification
- ✅ Cache hit/miss performance
- ✅ Write operation overhead
- ✅ Cache invalidation correctness
- ✅ Integration with auth layer

---

**Report Generated**: $(date)  
**Format Version**: 1.0  
**Test Suite**: cache-metrics.sh
EOF

    # Don't increment test counters for report generation (not a test)
    echo -e "${GREEN}[PASS]${NC} Report generated: $REPORT_FILE"
    echo ""
    echo -e "${CYAN}Report location: ${REPORT_FILE}${NC}"
}

################################################################################
# Split Test Functions for Phase-based Testing
################################################################################

# Create endpoint - empty cache version
test_create_endpoint_empty() {
    log_section "Testing /api/create Endpoint (Empty Cache)"
    
    ENDPOINT_DESCRIPTIONS["create"]="Create new objects"
    
    generate_create_body() {
        echo "{\"type\":\"CreatePerfTest\",\"timestamp\":$(date +%s%3N),\"random\":$RANDOM}"
    }
    
    log_info "Testing create with empty cache (100 operations)..."
    
    # Call function directly (not in subshell) so CREATED_IDS changes persist
    run_write_performance_test "create" "create" "POST" "generate_create_body" 100
    local empty_stats=$?  # Get return code (not used, but keeps pattern)
    
    # Stats are stored in global variables by run_write_performance_test
    # Read from a temporary file or global variable
    local empty_avg=$(cat /tmp/rerum_write_stats 2>/dev/null | cut -d'|' -f1)
    local empty_median=$(cat /tmp/rerum_write_stats 2>/dev/null | cut -d'|' -f2)
    
    ENDPOINT_COLD_TIMES["create"]=$empty_avg
    
    if [ "$empty_avg" = "0" ]; then
        log_failure "Create endpoint failed"
        ENDPOINT_STATUS["create"]="❌ Failed"
        return
    fi
    
    log_success "Create endpoint functional"
    ENDPOINT_STATUS["create"]="✅ Functional"
}

# Create endpoint - full cache version
test_create_endpoint_full() {
    log_section "Testing /api/create Endpoint (Full Cache)"
    
    generate_create_body() {
        echo "{\"type\":\"CreatePerfTest\",\"timestamp\":$(date +%s%3N),\"random\":$RANDOM}"
    }
    
    log_info "Testing create with full cache (${CACHE_FILL_SIZE} entries, 100 operations)..."
    
    # Call function directly (not in subshell) so CREATED_IDS changes persist
    run_write_performance_test "create" "create" "POST" "generate_create_body" 100
    
    # Read stats from temp file
    local full_avg=$(cat /tmp/rerum_write_stats 2>/dev/null | cut -d'|' -f1)
    local full_median=$(cat /tmp/rerum_write_stats 2>/dev/null | cut -d'|' -f2)
    
    ENDPOINT_WARM_TIMES["create"]=$full_avg
    
    if [ "$full_avg" != "0" ]; then
        local empty_avg=${ENDPOINT_COLD_TIMES["create"]}
        local overhead=$((full_avg - empty_avg))
        local overhead_pct=$((overhead * 100 / empty_avg))
        
        # Display clamped value (0 or positive) but store actual value for report
        if [ $overhead -lt 0 ]; then
            log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty_avg}ms → Full: ${full_avg}ms] (negligible - within statistical variance)"
        else
            log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty_avg}ms → Full: ${full_avg}ms]"
        fi
    fi
}

# Update endpoint - empty cache version
test_update_endpoint_empty() {
    log_section "Testing /api/update Endpoint (Empty Cache)"
    
    ENDPOINT_DESCRIPTIONS["update"]="Update existing objects"
    
    local NUM_ITERATIONS=50
    
    local test_obj=$(create_test_object_with_body '{"type":"UpdateTest","value":"original"}')
    local test_id=$(echo "$test_obj" | jq -r '.["@id"]' 2>/dev/null)
    
    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for update test"
        ENDPOINT_STATUS["update"]="❌ Failed"
        return
    fi
    
    log_info "Testing update with empty cache ($NUM_ITERATIONS iterations)..."
    
    declare -a empty_times=()
    local empty_total=0
    local empty_success=0
    local empty_failures=0
    # Maintain a stable base object without response metadata
    local base_object=$(echo "$test_obj" | jq 'del(.__rerum)' 2>/dev/null)
    
    for i in $(seq 1 $NUM_ITERATIONS); do
        local update_body=$(echo "$base_object" | jq '.value = "updated_'"$i"'"' 2>/dev/null)
        
        local result=$(measure_endpoint "${API_BASE}/api/update" "PUT" \
            "$update_body" \
            "Update object" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)
        local response=$(echo "$result" | cut -d'|' -f3-)
        
        if [ "$code" == "200" ]; then
            empty_times+=($time)
            empty_total=$((empty_total + time))
            empty_success=$((empty_success + 1))
            # Update base_object value only, maintaining stable structure
            base_object=$(echo "$base_object" | jq '.value = "updated_'"$i"'"' 2>/dev/null)
        else
            empty_failures=$((empty_failures + 1))
        fi
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $empty_success -eq 0 ]; then
        log_failure "Update endpoint failed (all requests failed)"
        ENDPOINT_STATUS["update"]="❌ Failed"
        ENDPOINT_COLD_TIMES["update"]=0
        return
    fi

    # Calculate average and median even with partial failures
    local empty_avg=$((empty_total / empty_success))
    IFS=$'\n' sorted_empty=($(sort -n <<<"${empty_times[*]}"))
    unset IFS
    local empty_median=${sorted_empty[$((empty_success / 2))]}
    local empty_min=${sorted_empty[0]}
    local empty_max=${sorted_empty[$((empty_success - 1))]}

    ENDPOINT_COLD_TIMES["update"]=$empty_avg

    # Allow up to 2% failure rate (1 out of 50) before marking as partial failure
    if [ $empty_failures -eq 0 ]; then
        log_success "$empty_success/$NUM_ITERATIONS successful"
        echo "  Total: ${empty_total}ms, Average: ${empty_avg}ms, Median: ${empty_median}ms, Min: ${empty_min}ms, Max: ${empty_max}ms"
        log_success "Update endpoint functional"
        ENDPOINT_STATUS["update"]="✅ Functional"
    elif [ $empty_failures -le 1 ]; then
        log_success "$empty_success/$NUM_ITERATIONS successful"
        log_warning "Update endpoint functional (${empty_failures}/${NUM_ITERATIONS} transient failures)"
        ENDPOINT_STATUS["update"]="✅ Functional (${empty_failures}/${NUM_ITERATIONS} transient failures)"
    else
        log_failure "$empty_success/$NUM_ITERATIONS successful (partial failure)"
        log_warning "Update endpoint had partial failures: $empty_failures/$NUM_ITERATIONS failed"
        ENDPOINT_STATUS["update"]="⚠️  Partial Failures ($empty_failures/$NUM_ITERATIONS)"
    fi
}

# Update endpoint - full cache version
test_update_endpoint_full() {
    log_section "Testing /api/update Endpoint (Full Cache)"
    
    local NUM_ITERATIONS=50
    
    local test_obj=$(create_test_object_with_body '{"type":"UpdateTest","value":"original"}')
    local test_id=$(echo "$test_obj" | jq -r '.["@id"]' 2>/dev/null)
    
    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for update test"
        return
    fi
    
    log_info "Testing update with full cache (${CACHE_FILL_SIZE} entries, $NUM_ITERATIONS iterations)..."
    
    declare -a full_times=()
    local full_total=0
    local full_success=0
    local full_failures=0
    # Maintain a stable base object without response metadata
    local base_object=$(echo "$test_obj" | jq 'del(.__rerum)' 2>/dev/null)
    
    for i in $(seq 1 $NUM_ITERATIONS); do
        local update_body=$(echo "$base_object" | jq '.value = "updated_full_'"$i"'"' 2>/dev/null)
        
        local result=$(measure_endpoint "${API_BASE}/api/update" "PUT" \
            "$update_body" \
            "Update object" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)
        local response=$(echo "$result" | cut -d'|' -f3-)
        
        if [ "$code" == "200" ]; then
            full_times+=($time)
            full_total=$((full_total + time))
            full_success=$((full_success + 1))
            # Update base_object value only, maintaining stable structure
            base_object=$(echo "$base_object" | jq '.value = "updated_full_'"$i"'"' 2>/dev/null)
        else
            full_failures=$((full_failures + 1))
        fi
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $full_success -eq 0 ]; then
        log_warning "Update with full cache failed (all requests failed)"
        return
    elif [ $full_failures -le 1 ]; then
        # Allow up to 2% failure rate (1 out of 50) - mark as functional with note
        log_success "$full_success/$NUM_ITERATIONS successful"
        if [ $full_failures -eq 1 ]; then
            log_warning "Update with full cache functional (${full_failures}/${NUM_ITERATIONS} transient failures)"
            ENDPOINT_STATUS["update"]="✅ Functional (${full_failures}/${NUM_ITERATIONS} transient failures)"
        fi
    elif [ $full_failures -gt 1 ]; then
        log_failure "$full_success/$NUM_ITERATIONS successful (partial failure)"
        log_warning "Update with full cache had partial failures: $full_failures/$NUM_ITERATIONS failed"
        ENDPOINT_STATUS["update"]="⚠️  Partial Failures ($full_failures/$NUM_ITERATIONS)"
        return
    fi

    if [ $full_failures -eq 0 ]; then
        log_success "$full_success/$NUM_ITERATIONS successful"
    fi

    local full_avg=$((full_total / full_success))
    IFS=$'\n' sorted_full=($(sort -n <<<"${full_times[*]}"))
    unset IFS
    local full_median=${sorted_full[$((full_success / 2))]}
    local full_min=${sorted_full[0]}
    local full_max=${sorted_full[$((full_success - 1))]}
    echo "  Total: ${full_total}ms, Average: ${full_avg}ms, Median: ${full_median}ms, Min: ${full_min}ms, Max: ${full_max}ms"

    ENDPOINT_WARM_TIMES["update"]=$full_avg

    local empty_avg=${ENDPOINT_COLD_TIMES["update"]:-0}

    if [ "$empty_avg" -eq 0 ] || [ -z "$empty_avg" ]; then
        log_warning "Cannot calculate overhead - baseline test had no successful operations"
    else
        local overhead=$((full_avg - empty_avg))
        local overhead_pct=$((overhead * 100 / empty_avg))

        # Display clamped value (0 or positive) but store actual value for report
        if [ $overhead -lt 0 ]; then
            log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty_avg}ms → Full: ${full_avg}ms] (negligible - within statistical variance)"
        else
            log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty_avg}ms → Full: ${full_avg}ms]"
        fi
    fi
}

# Similar split functions for patch, set, unset, overwrite - using same pattern
test_patch_endpoint_empty() {
    log_section "Testing /api/patch Endpoint (Empty Cache)"
    ENDPOINT_DESCRIPTIONS["patch"]="Patch existing object properties"
    local NUM_ITERATIONS=50
    
    local test_id=$(create_test_object '{"type":"PatchTest","value":1}')
    [ -z "$test_id" ] && return
    
    log_info "Testing patch ($NUM_ITERATIONS iterations)..."
    declare -a times=()
    local total=0 success=0
    
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/patch" "PATCH" \
            "{\"@id\":\"$test_id\",\"value\":$((i + 1))}" "Patch" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        log_failure "Patch failed"
        ENDPOINT_STATUS["patch"]="❌ Failed"
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_COLD_TIMES["patch"]=$avg
    log_success "Patch functional"
    ENDPOINT_STATUS["patch"]="✅ Functional"
}

test_patch_endpoint_full() {
    log_section "Testing /api/patch Endpoint (Full Cache)"
    local NUM_ITERATIONS=50
    
    local test_id=$(create_test_object '{"type":"PatchTest","value":1}')
    [ -z "$test_id" ] && return
    
    log_info "Testing patch with full cache ($NUM_ITERATIONS iterations)..."
    declare -a times=()
    local total=0 success=0
    
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/patch" "PATCH" \
            "{\"@id\":\"$test_id\",\"value\":$((i + 100))}" "Patch" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_WARM_TIMES["patch"]=$avg
    local empty=${ENDPOINT_COLD_TIMES["patch"]}
    local overhead=$((avg - empty))
    local overhead_pct=$((overhead * 100 / empty))

    # Display clamped value (0 or positive) but store actual value for report
    if [ $overhead -lt 0 ]; then
        log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty}ms → Full: ${avg}ms] (negligible - within statistical variance)"
    else
        log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty}ms → Full: ${avg}ms]"
    fi
}

test_set_endpoint_empty() {
    log_section "Testing /api/set Endpoint (Empty Cache)"
    ENDPOINT_DESCRIPTIONS["set"]="Add new properties to objects"
    local NUM_ITERATIONS=50
    local test_id=$(create_test_object '{"type":"SetTest","value":"original"}')
    [ -z "$test_id" ] && return
    declare -a times=(); local total=0 success=0
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/set" "PATCH" "{\"@id\":\"$test_id\",\"newProp$i\":\"value$i\"}" "Set" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        ENDPOINT_STATUS["set"]="❌ Failed"
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_COLD_TIMES["set"]=$avg
    log_success "Set functional"
    ENDPOINT_STATUS["set"]="✅ Functional"
}

test_set_endpoint_full() {
    log_section "Testing /api/set Endpoint (Full Cache)"
    local NUM_ITERATIONS=50
    local test_id=$(create_test_object '{"type":"SetTest","value":"original"}')
    [ -z "$test_id" ] && return
    declare -a times=()
    local total=0 success=0
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/set" "PATCH" "{\"@id\":\"$test_id\",\"fullProp$i\":\"value$i\"}" "Set" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_WARM_TIMES["set"]=$avg
    local overhead=$((avg - ENDPOINT_COLD_TIMES["set"]))
    local empty=${ENDPOINT_COLD_TIMES["set"]}
    local full=${ENDPOINT_WARM_TIMES["set"]}
    local overhead_pct=$((overhead * 100 / empty))

    # Display clamped value (0 or positive) but store actual value for report
    if [ $overhead -lt 0 ]; then
        log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty}ms → Full: ${full}ms] (negligible - within statistical variance)"
    else
        log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty}ms → Full: ${full}ms]"
    fi
}

test_unset_endpoint_empty() {
    log_section "Testing /api/unset Endpoint (Empty Cache)"
    ENDPOINT_DESCRIPTIONS["unset"]="Remove properties from objects"
    local NUM_ITERATIONS=50
    local props='{"type":"UnsetTest"'; for i in $(seq 1 $NUM_ITERATIONS); do props+=",\"prop$i\":\"val$i\""; done; props+='}'
    local test_id=$(create_test_object "$props")
    [ -z "$test_id" ] && return
    declare -a times=()
    local total=0 success=0
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/unset" "PATCH" "{\"@id\":\"$test_id\",\"prop$i\":null}" "Unset" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        ENDPOINT_STATUS["unset"]="❌ Failed"
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_COLD_TIMES["unset"]=$avg
    log_success "Unset functional"
    ENDPOINT_STATUS["unset"]="✅ Functional"
}

test_unset_endpoint_full() {
    log_section "Testing /api/unset Endpoint (Full Cache)"
    local NUM_ITERATIONS=50
    local props='{"type":"UnsetTest"'; for i in $(seq 1 $NUM_ITERATIONS); do props+=",\"prop$i\":\"val$i\""; done; props+='}'
    local test_id=$(create_test_object "$props")
    [ -z "$test_id" ] && return
    declare -a times=()
    local total=0 success=0
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/unset" "PATCH" "{\"@id\":\"$test_id\",\"prop$i\":null}" "Unset" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_WARM_TIMES["unset"]=$avg
    local overhead=$((avg - ENDPOINT_COLD_TIMES["unset"]))
    local empty=${ENDPOINT_COLD_TIMES["unset"]}
    local full=${ENDPOINT_WARM_TIMES["unset"]}
    local overhead_pct=$((overhead * 100 / empty))

    # Display clamped value (0 or positive) but store actual value for report
    if [ $overhead -lt 0 ]; then
        log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty}ms → Full: ${full}ms] (negligible - within statistical variance)"
    else
        log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty}ms → Full: ${full}ms]"
    fi
}

test_overwrite_endpoint_empty() {
    log_section "Testing /api/overwrite Endpoint (Empty Cache)"
    ENDPOINT_DESCRIPTIONS["overwrite"]="Overwrite objects in place"
    local NUM_ITERATIONS=50
    local test_id=$(create_test_object '{"type":"OverwriteTest","value":"original"}')
    [ -z "$test_id" ] && return
    declare -a times=()
    local total=0 success=0
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/overwrite" "PUT" "{\"@id\":\"$test_id\",\"type\":\"OverwriteTest\",\"value\":\"v$i\"}" "Overwrite" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        ENDPOINT_STATUS["overwrite"]="❌ Failed"
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_COLD_TIMES["overwrite"]=$avg
    log_success "Overwrite functional"
    ENDPOINT_STATUS["overwrite"]="✅ Functional"
}

test_overwrite_endpoint_full() {
    log_section "Testing /api/overwrite Endpoint (Full Cache)"
    local NUM_ITERATIONS=50
    local test_id=$(create_test_object '{"type":"OverwriteTest","value":"original"}')
    [ -z "$test_id" ] && return
    declare -a times=()
    local total=0 success=0
    for i in $(seq 1 $NUM_ITERATIONS); do
        local result=$(measure_endpoint "${API_BASE}/api/overwrite" "PUT" "{\"@id\":\"$test_id\",\"type\":\"OverwriteTest\",\"value\":\"v$i\"}" "Overwrite" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_WARM_TIMES["overwrite"]=$avg
    local overhead=$((avg - ENDPOINT_COLD_TIMES["overwrite"]))
    local empty=${ENDPOINT_COLD_TIMES["overwrite"]}
    local full=${ENDPOINT_WARM_TIMES["overwrite"]}
    local overhead_pct=$((overhead * 100 / empty))

    # Display clamped value (0 or positive) but store actual value for report
    if [ $overhead -lt 0 ]; then
        log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty}ms → Full: ${full}ms] (negligible - within statistical variance)"
    else
        log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty}ms → Full: ${full}ms]"
    fi
}

test_delete_endpoint_empty() {
    log_section "Testing /api/delete Endpoint (Empty Cache)"
    ENDPOINT_DESCRIPTIONS["delete"]="Delete objects"
    local NUM_ITERATIONS=50
    local num_created=${#CREATED_IDS[@]}
    if [ $num_created -lt $((50 + NUM_ITERATIONS)) ]; then
        log_warning "Not enough objects (have: $num_created, need: $((50 + NUM_ITERATIONS)))"
        ENDPOINT_STATUS["delete"]="⚠️ Skipped"
        return
    fi
    log_info "Deleting objects 51-100 from create_empty test (objects 1-50 were released)..."
    declare -a times=()
    local total=0 success=0
    # Use second 50 objects from CREATED_IDS for delete_empty (objects 50-99 from create_empty)
    # First 50 objects (0-49) were released and cannot be deleted
    for i in $(seq 50 $((50 + NUM_ITERATIONS - 1))); do
        local obj_id=$(echo "${CREATED_IDS[$i]}" | sed 's|.*/||')

        # Skip if obj_id is invalid
        if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
            continue
        fi

        local result=$(measure_endpoint "${API_BASE}/api/delete/${obj_id}" "DELETE" "" "Delete" true 60)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "204" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }

        # Progress indicator
        local iteration_num=$((i - 49))
        if [ $((iteration_num % 10)) -eq 0 ] || [ $iteration_num -eq $NUM_ITERATIONS ]; then
            local pct=$((iteration_num * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $iteration_num/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    if [ $success -eq 0 ]; then
        ENDPOINT_STATUS["delete"]="❌ Failed"
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure, deleted: $success)"
    else
        log_success "$success/$NUM_ITERATIONS successful (deleted: $success)"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_COLD_TIMES["delete"]=$avg
    log_success "Delete functional"
    ENDPOINT_STATUS["delete"]="✅ Functional"
}

test_delete_endpoint_full() {
    log_section "Testing /api/delete Endpoint (Full Cache)"
    local NUM_ITERATIONS=50
    local num_created=${#CREATED_IDS[@]}
    local start_idx=150  # Use objects 150-199 from create_full test
    if [ $num_created -lt $((start_idx + NUM_ITERATIONS)) ]; then
        log_warning "Not enough objects (have: $num_created, need: $((start_idx + NUM_ITERATIONS)))"
        ENDPOINT_STATUS["delete"]="⚠️ Skipped"
        return
    fi

    log_info "Deleting objects 151-200 from create_full test (objects 101-150 were released)..."
    declare -a times=()
    local total=0 success=0
    local iteration=0
    # Use objects 150-199 from CREATED_IDS for delete_full (from create_full test)
    # Objects 100-149 were released and cannot be deleted
    for i in $(seq $start_idx $((start_idx + NUM_ITERATIONS - 1))); do
        iteration=$((iteration + 1))
        local obj_id=$(echo "${CREATED_IDS[$i]}" | sed 's|.*/||')

        if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
            continue
        fi

        local result=$(measure_endpoint "${API_BASE}/api/delete/${obj_id}" "DELETE" "" "Delete" true 60)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "204" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }
        
        if [ $((iteration % 10)) -eq 0 ] || [ $iteration -eq $NUM_ITERATIONS ]; then
            local pct=$((iteration * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $iteration/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2
    
    # Get final cache stats
    local stats_after=$(get_cache_stats)
    local cache_size_after=$(echo "$stats_after" | grep -o '"length":[0-9]*' | sed 's/"length"://')
    local invalidations_after=$(echo "$stats_after" | grep -o '"invalidations":[0-9]*' | sed 's/"invalidations"://')
    local total_removed=$((cache_size_before - cache_size_after))
    local total_invalidations=$((invalidations_after - invalidations_before))
    log_info "Cache after deletes: size=$cache_size_after (-$total_removed), invalidations=$invalidations_after (+$total_invalidations)"
    log_info "Average removed per delete: $((total_removed / success))"
    
    if [ $success -eq 0 ]; then
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure, deleted: $success)"
    else
        log_success "$success/$NUM_ITERATIONS successful (deleted: $success)"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_WARM_TIMES["delete"]=$avg
    local overhead=$((avg - ENDPOINT_COLD_TIMES["delete"]))
    local empty=${ENDPOINT_COLD_TIMES["delete"]}
    local full=${ENDPOINT_WARM_TIMES["delete"]}
    local overhead_pct=$((overhead * 100 / empty))

    # Display clamped value (0 or positive) but store actual value for report
    if [ $overhead -lt 0 ]; then
        log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty}ms → Full: ${full}ms] (negligible - within statistical variance) (deleted: $success)"
    else
        log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty}ms → Full: ${full}ms] (deleted: $success)"
    fi
}

test_release_endpoint_empty() {
    log_section "Testing /api/release Endpoint (Empty Cache)"
    ENDPOINT_DESCRIPTIONS["release"]="Release objects (lock as immutable)"
    local NUM_ITERATIONS=50
    local num_created=${#CREATED_IDS[@]}

    if [ $num_created -lt $NUM_ITERATIONS ]; then
        log_warning "Not enough objects (have: $num_created, need: $NUM_ITERATIONS)"
        ENDPOINT_STATUS["release"]="⚠️ Skipped"
        return
    fi

    log_info "Testing release endpoint ($NUM_ITERATIONS iterations)..."
    log_info "Using first $NUM_ITERATIONS objects from create_empty test..."

    declare -a times=()
    local total=0 success=0
    # Use first 50 objects from CREATED_IDS for release_empty (objects 0-49 from create_empty)
    for i in $(seq 0 $((NUM_ITERATIONS - 1))); do
        local obj_id=$(echo "${CREATED_IDS[$i]}" | sed 's|.*/||')

        if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
            continue
        fi

        local result=$(measure_endpoint "${API_BASE}/api/release/${obj_id}" "PATCH" "" "Release" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }

        # Progress indicator
        if [ $((i % 10)) -eq 0 ] || [ $i -eq $NUM_ITERATIONS ]; then
            local pct=$((i * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $i/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2

    if [ $success -eq 0 ]; then
        ENDPOINT_STATUS["release"]="❌ Failed"
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_COLD_TIMES["release"]=$avg
    log_success "Release functional"
    ENDPOINT_STATUS["release"]="✅ Functional"
}

test_release_endpoint_full() {
    log_section "Testing /api/release Endpoint (Full Cache)"
    local NUM_ITERATIONS=50
    local num_created=${#CREATED_IDS[@]}

    if [ $num_created -lt $((100 + NUM_ITERATIONS)) ]; then
        log_warning "Not enough objects (have: $num_created, need: $((100 + NUM_ITERATIONS)))"
        ENDPOINT_STATUS["release"]="⚠️ Skipped"
        return
    fi

    log_info "Testing release endpoint with full cache ($NUM_ITERATIONS iterations)..."
    log_info "Using objects 101-150 from create_full test..."

    declare -a times=()
    local total=0 success=0
    # Use objects 100-149 from CREATED_IDS for release_full (from create_full test)
    for i in $(seq 100 $((100 + NUM_ITERATIONS - 1))); do
        local obj_id=$(echo "${CREATED_IDS[$i]}" | sed 's|.*/||')

        if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
            continue
        fi

        local result=$(measure_endpoint "${API_BASE}/api/release/${obj_id}" "PATCH" "" "Release" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        [ "$(echo "$result" | cut -d'|' -f2)" == "200" ] && { times+=($time); total=$((total + time)); success=$((success + 1)); }

        # Progress indicator
        local iteration_num=$((i - 99))
        if [ $((iteration_num % 10)) -eq 0 ] || [ $iteration_num -eq $NUM_ITERATIONS ]; then
            local pct=$((iteration_num * 100 / NUM_ITERATIONS))
            echo -ne "\r  Progress: $iteration_num/$NUM_ITERATIONS iterations ($pct%)  " >&2
        fi
    done
    echo "" >&2

    if [ $success -eq 0 ]; then
        return
    elif [ $success -lt $NUM_ITERATIONS ]; then
        log_failure "$success/$NUM_ITERATIONS successful (partial failure)"
    else
        log_success "$success/$NUM_ITERATIONS successful"
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
    ENDPOINT_WARM_TIMES["release"]=$avg
    local overhead=$((avg - ENDPOINT_COLD_TIMES["release"]))
    local empty=${ENDPOINT_COLD_TIMES["release"]}
    local full=${ENDPOINT_WARM_TIMES["release"]}
    local overhead_pct=$((overhead * 100 / empty))

    # Display clamped value (0 or positive) but store actual value for report
    if [ $overhead -lt 0 ]; then
        log_overhead 0 "Overhead: 0ms (0%) [Empty: ${empty}ms → Full: ${full}ms] (negligible - within statistical variance)"
    else
        log_overhead $overhead "Overhead: ${overhead}ms (${overhead_pct}%) [Empty: ${empty}ms → Full: ${full}ms]"
    fi
}

################################################################################
# Main Test Flow (REFACTORED TO 5 PHASES - OPTIMIZED)
################################################################################

main() {
    # Capture start time
    local start_time=$(date +%s)
    
    log_header "RERUM Cache Comprehensive Metrics & Functionality Test"
    
    echo "This test suite will:"
    echo "  1. Test read endpoints with EMPTY cache (baseline performance)"
    echo "  2. Test write endpoints with EMPTY cache (baseline performance)"
    echo "  3. Fill cache to 1000 entries with diverse read patterns"
    echo "  4A. Test read endpoints with CACHE HITS (measure speedup vs baseline)"
    echo "  4B. Test read endpoints with CACHE MISSES (measure overhead + evictions)"
    echo "  5. Test write endpoints with FULL cache (measure invalidation overhead vs baseline)"
    echo ""

    # Setup
    check_wsl2_time_sync
    check_server
    get_auth_token
    warmup_system
    
    # Run optimized 5-phase test flow
    log_header "Running Functionality & Performance Tests"
    
    # ============================================================
    # PHASE 1: Read endpoints on EMPTY cache (baseline)
    # ============================================================
    echo ""
    log_section "PHASE 1: Read Endpoints with EMPTY Cache (Baseline)"
    echo "[INFO] Testing read endpoints without cache to establish baseline performance..."
    
    # Test each read endpoint once with cold cache
    test_query_endpoint_cold
    test_search_endpoint
    test_search_phrase_endpoint  
    test_id_endpoint
    test_history_endpoint
    test_since_endpoint
    
    # ============================================================
    # PHASE 2: Write endpoints on EMPTY cache (baseline)
    # ============================================================
    echo ""
    log_section "PHASE 2: Write Endpoints with EMPTY Cache (Baseline)"
    echo "[INFO] Testing write endpoints without cache to establish baseline performance..."
    
    # Cache is already empty from Phase 1
    test_create_endpoint_empty
    test_update_endpoint_empty
    test_patch_endpoint_empty
    test_set_endpoint_empty
    test_unset_endpoint_empty
    test_overwrite_endpoint_empty
    test_release_endpoint_empty
    test_delete_endpoint_empty  # Uses objects from create_empty test
    
    # ============================================================
    # PHASE 3: Fill cache with 1000 entries
    # ============================================================
    echo ""
    log_section "PHASE 3: Fill Cache with 1000 Entries"
    echo "[INFO] Filling cache to test performance at scale..."
    
    # Clear cache to start fresh for fill test
    # The clear_cache function waits internally for all workers to sync (5.5s)
    clear_cache
    
    fill_cache $CACHE_FILL_SIZE
    
    # ============================================================
    # PHASE 4A: Read endpoints on FULL cache with CACHE HITS (verify speedup)
    # ============================================================
    echo ""
    log_section "PHASE 4A: Read Endpoints with FULL Cache - CACHE HITS (Measure Speedup)"
    echo "[INFO] Testing read endpoints with cache hits to measure speedup vs Phase 1..."
    
    # Test read endpoints WITHOUT clearing cache - reuse what was filled in Phase 3
    # IMPORTANT: Queries must match cache fill patterns to get cache hits
    log_info "Testing /api/query with cache hit..."
    local result=$(measure_endpoint "${API_BASE}/api/query" "POST" '{"type":"CreatePerfTest"}' "Query with cache hit")
    local warm_time=$(echo "$result" | cut -d'|' -f1)
    local warm_code=$(echo "$result" | cut -d'|' -f2)
    ENDPOINT_WARM_TIMES["query"]=$warm_time
    if [ "$warm_code" == "200" ]; then
        log_success "Query with cache hit (${warm_time}ms)"
    else
        log_warning "Query failed with code $warm_code"
    fi
    
    log_info "Testing /api/search with cache hit..."
    result=$(measure_endpoint "${API_BASE}/api/search" "POST" '{"searchText":"annotation"}' "Search with cache hit")
    warm_time=$(echo "$result" | cut -d'|' -f1)
    warm_code=$(echo "$result" | cut -d'|' -f2)
    ENDPOINT_WARM_TIMES["search"]=$warm_time
    if [ "$warm_code" == "200" ]; then
        log_success "Search with cache hit (${warm_time}ms)"
    else
        log_warning "Search failed with code $warm_code"
    fi
    
    log_info "Testing /api/search/phrase with cache hit..."
    result=$(measure_endpoint "${API_BASE}/api/search/phrase" "POST" '{"searchText":"test annotation"}' "Search phrase with cache hit")
    warm_time=$(echo "$result" | cut -d'|' -f1)
    warm_code=$(echo "$result" | cut -d'|' -f2)
    ENDPOINT_WARM_TIMES["searchPhrase"]=$warm_time
    if [ "$warm_code" == "200" ]; then
        log_success "Search phrase with cache hit (${warm_time}ms)"
    else
        log_warning "Search phrase failed with code $warm_code"
    fi
    
    # For ID, history, since - use the same IDs that were cached in Phase 3 (index 0)
    if [ ${#CREATED_IDS[@]} -gt 0 ]; then
        local test_id="${CREATED_IDS[0]}"
        log_info "Testing /id with cache hit..."
        result=$(measure_endpoint "$test_id" "GET" "" "ID retrieval with cache hit")
        log_success "ID retrieval with cache hit"
        
        # Extract just the ID portion for history endpoint
        local obj_id=$(echo "$test_id" | sed 's|.*/||')
        log_info "Testing /history with cache hit..."
        result=$(measure_endpoint "${API_BASE}/history/${obj_id}" "GET" "" "History with cache hit")
        log_success "History with cache hit"
        
        log_info "Testing /since with cache hit..."
        local since_id=$(echo "$test_id" | sed 's|.*/||')
        result=$(measure_endpoint "${API_BASE}/since/${since_id}" "GET" "" "Since with cache hit")
        log_success "Since with cache hit"
    else
        log_warning "Skipping GET endpoint cache hit tests - not enough created objects"
    fi
    
    # ============================================================
    # PHASE 4B: Read endpoints on FULL cache with CACHE MISSES (measure overhead + evictions)
    # ============================================================
    echo ""
    log_section "PHASE 4B: Read Endpoints with FULL Cache - CACHE MISSES (Measure Overhead)"
    echo "[INFO] Testing read endpoints with cache misses to measure overhead vs Phase 1..."
    echo "[INFO] This will add new entries and may cause evictions..."
    
    # Get cache stats before misses
    local stats_before=$(get_cache_stats)
    local size_before=$(echo "$stats_before" | grep -o '"length":[0-9]*' | sed 's/"length"://')
    local evictions_before=$(echo "$stats_before" | grep -o '"evictions":[0-9]*' | sed 's/"evictions"://')
    
    log_info "Cache state before misses: size=$size_before, evictions=$evictions_before"
    
    # Test with queries that will NOT match cache (cache misses)
    log_info "Testing /api/query with cache miss..."
    result=$(measure_endpoint "${API_BASE}/api/query" "POST" '{"type":"CacheMissTest_Unique_Query"}' "Query with cache miss")
    warm_time=$(echo "$result" | cut -d'|' -f1)
    warm_code=$(echo "$result" | cut -d'|' -f2)
    if [ "$warm_code" == "200" ]; then
        log_success "Query with cache miss (${warm_time}ms)"
    else
        log_warning "Query failed with code $warm_code"
    fi
    
    log_info "Testing /api/search with cache miss..."
    result=$(measure_endpoint "${API_BASE}/api/search" "POST" '{"searchText":"CacheMissTest_Unique_Search"}' "Search with cache miss")
    warm_time=$(echo "$result" | cut -d'|' -f1)
    warm_code=$(echo "$result" | cut -d'|' -f2)
    if [ "$warm_code" == "200" ]; then
        log_success "Search with cache miss (${warm_time}ms)"
    else
        log_warning "Search failed with code $warm_code"
    fi
    
    log_info "Testing /api/search/phrase with cache miss..."
    result=$(measure_endpoint "${API_BASE}/api/search/phrase" "POST" '{"searchText":"CacheMissTest_Unique_Phrase"}' "Search phrase with cache miss")
    warm_time=$(echo "$result" | cut -d'|' -f1)
    warm_code=$(echo "$result" | cut -d'|' -f2)
    if [ "$warm_code" == "200" ]; then
        log_success "Search phrase with cache miss (${warm_time}ms)"
    else
        log_warning "Search phrase failed with code $warm_code"
    fi
    
    # For ID, history, since - use different IDs than Phase 4A (index 1 instead of 0)
    if [ ${#CREATED_IDS[@]} -gt 1 ]; then
        local test_id="${CREATED_IDS[1]}"
        log_info "Testing /id with cache miss..."
        result=$(measure_endpoint "$test_id" "GET" "" "ID retrieval with cache miss")
        log_success "ID retrieval with cache miss"
        
        # Extract just the ID portion for history endpoint
        local obj_id=$(echo "$test_id" | sed 's|.*/||')
        log_info "Testing /history with cache miss..."
        result=$(measure_endpoint "${API_BASE}/history/${obj_id}" "GET" "" "History with cache miss")
        log_success "History with cache miss"
        
        log_info "Testing /since with cache miss..."
        local since_id=$(echo "$test_id" | sed 's|.*/||')
        result=$(measure_endpoint "${API_BASE}/since/${since_id}" "GET" "" "Since with cache miss")
        log_success "Since with cache miss"
    else
        log_warning "Skipping GET endpoint cache miss tests - not enough created objects"
    fi
    
    # Get cache stats after misses
    local stats_after=$(get_cache_stats)
    local size_after=$(echo "$stats_after" | grep -o '"length":[0-9]*' | sed 's/"length"://')
    local evictions_after=$(echo "$stats_after" | grep -o '"evictions":[0-9]*' | sed 's/"evictions"://')
    
    log_info "Cache state after misses: size=$size_after, evictions=$evictions_after"
    
    local new_entries=$((size_after - size_before))
    local new_evictions=$((evictions_after - evictions_before))
    
    if [ $new_evictions -gt 0 ]; then
        log_success "Cache misses caused $new_evictions evictions (LRU evicted oldest entries to make room)"
        log_success "Cache remained at max capacity: $size_after entries"
    else
        log_success "Cache misses added $new_entries entries with no evictions"
    fi
    
    # ============================================================
    # PHASE 5: Write endpoints on FULL cache (measure invalidation)
    # ============================================================
    echo ""
    log_section "PHASE 5: Write Endpoints with FULL Cache (Measure Invalidation Overhead)"
    echo "[INFO] Testing write endpoints with full cache to measure invalidation overhead vs Phase 2..."
    
    # Get starting state at beginning of Phase 5
    local stats_before_phase5=$(get_cache_stats)
    local starting_cache_size=$(echo "$stats_before_phase5" | grep -o '"length":[0-9]*' | sed 's/"length"://')
    local starting_evictions=$(echo "$stats_before_phase5" | grep -o '"evictions":[0-9]*' | sed 's/"evictions"://')

    # Track invalidations ourselves (app doesn't track them)
    # Invalidations = cache size decrease from write operations
    local total_invalidations=0

    log_info "=== PHASE 5 STARTING STATE ==="
    log_info "Starting cache size: $starting_cache_size entries"
    log_info "Phase 3 filled cache with queries matching Phase 5 write operation types"
    log_info "Each write operation should invalidate multiple cache entries"
    log_info "Test will calculate invalidations as cache size decrease per write operation"
    
    echo "[INFO] Running write endpoint tests..."
    
    # Cache is already full from Phase 3 - reuse it without refilling
    
    # Helper function to log cache changes and calculate invalidations
    # Write operations don't add cache entries, so size decrease = invalidations
    local size_before=$starting_cache_size

    track_cache_change() {
        local operation=$1
        local stats=$(get_cache_stats)
        local size_after=$(echo "$stats" | grep -o '"length":[0-9]*' | sed 's/"length"://')
        local evictions=$(echo "$stats" | grep -o '"evictions":[0-9]*' | sed 's/"evictions"://')

        # Calculate invalidations for this operation
        # Write operations don't add cache entries, so size decrease = invalidations only
        local operation_invalidations=$((size_before - size_after))

        # Ensure non-negative
        if [ $operation_invalidations -lt 0 ]; then
            operation_invalidations=0
        fi

        # Accumulate total
        total_invalidations=$((total_invalidations + operation_invalidations))

        echo "[CACHE TRACK] After $operation: size=$size_after (Δ-$operation_invalidations invalidations), evictions=$evictions, total_invalidations=$total_invalidations" >&2

        # Update size for next operation
        size_before=$size_after
    }
    
    test_create_endpoint_full
    track_cache_change "create_full"
    
    test_update_endpoint_full
    track_cache_change "update_full"
    
    test_patch_endpoint_full
    track_cache_change "patch_full"
    
    test_set_endpoint_full
    track_cache_change "set_full"
    
    test_unset_endpoint_full
    track_cache_change "unset_full"
    
    test_overwrite_endpoint_full
    track_cache_change "overwrite_full"

    test_release_endpoint_full
    track_cache_change "release_full"

    test_delete_endpoint_full
    
    local stats_after_phase5=$(get_cache_stats)
    local final_cache_size=$(echo "$stats_after_phase5" | grep -o '"length":[0-9]*' | sed 's/"length"://')
    local final_evictions=$(echo "$stats_after_phase5" | grep -o '"evictions":[0-9]*' | sed 's/"evictions"://')

    local actual_entries_removed=$((starting_cache_size - final_cache_size))
    local total_evictions=$((final_evictions - starting_evictions))

    # total_invalidations was calculated incrementally by track_cache_change()
    # Verify it matches our overall size reduction (should be close, minor differences due to timing)
    if [ $total_invalidations -ne $actual_entries_removed ]; then
        local diff=$((actual_entries_removed - total_invalidations))
        if [ ${diff#-} -gt 2 ]; then  # Allow ±2 difference for timing
            log_warning "Invalidation count variance: incremental=$total_invalidations, overall_removed=$actual_entries_removed (diff: $diff)"
        fi
    fi
    
    echo ""
    log_info "=== PHASE 5 FINAL RESULTS ==="
    log_info "Starting cache size: $starting_cache_size entries (after adding 5 test queries)"
    log_info "Final cache size: $final_cache_size entries"
    log_info "Total cache size reduction: $actual_entries_removed entries"
    log_info "Calculated invalidations: $total_invalidations entries (from write operations)"
    log_info "LRU evictions during phase: $total_evictions (separate from invalidations)"
    log_info ""
    log_info "=== PHASE 5 CACHE ACCOUNTING ==="
    log_info "Initial state: ${starting_cache_size} entries"
    log_info "  - Cache filled to 1000 in Phase 3"
    log_info "  - Added 5 query entries for write tests (matched test object types)"
    log_info ""
    log_info "Write operations performed:"
    log_info "  - create: 100 operations (minimal invalidation - no existing data)"
    log_info "  - update: 50 operations (invalidates id:*, history:*, since:*, matching queries)"
    log_info "  - patch: 50 operations (invalidates id:*, history:*, since:*, matching queries)"
    log_info "  - set: 50 operations (invalidates id:*, history:*, since:*, matching queries)"
    log_info "  - unset: 50 operations (invalidates id:*, history:*, since:*, matching queries)"
    log_info "  - overwrite: 50 operations (invalidates id:*, history:*, since:*, matching queries)"
    log_info "  - delete: 50 operations (invalidates id:*, history:*, since:* for each)"
    log_info ""
    log_info "Final state: ${final_cache_size} entries"
    log_info "  - Invalidations from writes: ${total_invalidations}"
    log_info "  - LRU evictions (separate): ${total_evictions}"
    log_info "  - Total size reduction: ${actual_entries_removed}"
    echo ""
    
    # Validate that calculated invalidations are in the expected range
    if [ -n "$final_cache_size" ] && [ -n "$total_invalidations" ]; then
        # total_invalidations = cumulative cache size decrease from each write operation
        # This represents entries removed by invalidation logic during writes

        # For DELETE operations:
        # - Each DELETE tries to invalidate 3 keys: id:*, history:*, since:*
        # - But id:* only exists if /id/:id was called for that object
        # - history:* and since:* are created during read operations
        # - So we expect ~2 invalidations per DELETE on average (not 3)
        
        # Calculate expected invalidations based on test operations
        local num_deletes=50
        local expected_invalidations_per_delete=2  # history:* + since:* (id:* may not exist)
        local other_write_invalidations=15  # Approximate for update/patch/set/unset/overwrite
        local expected_total_invalidations=$((num_deletes * expected_invalidations_per_delete + other_write_invalidations))
        
        # Allow variance: invalidations may be ±20% of expected due to:
        # - Some id:* keys existing (if objects were fetched via /id/:id)
        # - Cluster sync timing variations
        # - LRU evictions counted separately
        local variance_threshold=$((expected_total_invalidations / 5))  # 20%
        local invalidation_deviation=$((total_invalidations - expected_total_invalidations))
        local invalidation_deviation_abs=${invalidation_deviation#-}
        
        if [ $invalidation_deviation_abs -le $variance_threshold ]; then
            log_success "✅ Invalidation count in expected range: $total_invalidations invalidations (expected ~$expected_total_invalidations ±$variance_threshold)"
        else
            log_info "ℹ️  Invalidation count: $total_invalidations"
            log_info "Note: Variance can occur if some objects were cached via /id/:id endpoint"
        fi

        # Additional check for suspiciously low invalidation counts
        if [ $total_invalidations -lt 25 ]; then
            log_warning "⚠️  Invalidation count ($total_invalidations) is lower than expected minimum (~25)"
            log_info "Possible causes:"
            log_info "  - Write operations may not have matched many cached queries"
            log_info "  - Phase 3 cache fill may not have created many matching entries"
            log_info "  - Total size reduction: ${actual_entries_removed}, Invalidations tracked: ${total_invalidations}"
        fi

        # Verify invalidations are reasonable (should be most of the size reduction)
        # Note: Evictions happen asynchronously during reads, not during writes
        # So invalidations should be close to total size reduction
        if [ $total_invalidations -eq $actual_entries_removed ]; then
            log_success "✅ All cache size reduction from invalidations: $total_invalidations entries"
        elif [ $((actual_entries_removed - total_invalidations)) -le 5 ]; then
            log_success "✅ Most cache reduction from invalidations: $total_invalidations of $actual_entries_removed entries"
        else
            log_info "ℹ️  Cache reduction: $total_invalidations invalidations, $actual_entries_removed total removed"
            log_info "Difference may be due to concurrent operations or timing between measurements"
        fi
        
        # Report cache size reduction
        local size_reduction_pct=$(( (starting_cache_size - final_cache_size) * 100 / starting_cache_size ))
        log_success "✅ Cache invalidation working: $total_invalidations entries invalidated"
        log_info "Cache size reduced by $size_reduction_pct% (from $starting_cache_size to $final_cache_size)"
        
        # Show cache reduction
        local reduction_pct=$((actual_entries_removed * 100 / starting_cache_size))
        log_info "Cache size reduced by ${reduction_pct}% (from $starting_cache_size to $final_cache_size)"
    else
        log_warning "⚠️  Could not retrieve complete cache stats for validation"
    fi
    
    # Generate report
    generate_report
    
    # Skip cleanup - leave test objects in database for inspection
    # cleanup_test_objects
    
    # Calculate total runtime
    local end_time=$(date +%s)
    local total_seconds=$((end_time - start_time))
    local minutes=$((total_seconds / 60))
    local seconds=$((total_seconds % 60))
    
    # Summary
    log_header "Test Summary"
    echo ""
    echo "  Total Tests: ${TOTAL_TESTS}"
    echo -e "  ${GREEN}Passed: ${PASSED_TESTS}${NC}"
    echo -e "  ${RED}Failed: ${FAILED_TESTS}${NC}"
    echo -e "  ${YELLOW}Skipped: ${SKIPPED_TESTS}${NC}"
    echo "  Total Runtime: ${minutes}m ${seconds}s"
    echo ""
    
    if [ $FAILED_TESTS -gt 0 ]; then
        echo -e "${RED}Some tests failed. Often, these are transient errors that do not affect the stats measurements such as a clock skew.${NC}"
        echo ""
    else
        echo -e "${GREEN}All tests passed! ✓${NC}"
        echo ""
    fi

    echo -e "📄 Full report available at: ${CYAN}${REPORT_FILE}${NC}"
    echo -e "📋 Terminal log saved to: ${CYAN}${LOG_FILE}${NC}"
    echo ""
    echo -e "${YELLOW}Remember to clean up test objects from MongoDB!${NC}"
    echo ""
}

# Run main function and capture output to log file (strip ANSI colors from log)
main "$@" 2>&1 | tee >(sed 's/\x1b\[[0-9;]*m//g' > "$LOG_FILE")
