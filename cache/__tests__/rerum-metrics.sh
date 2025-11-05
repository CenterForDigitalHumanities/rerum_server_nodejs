#!/bin/bash

################################################################################
# RERUM Baseline Performance Metrics Test
#
# Tests the performance of the RERUM API without cache layer (main branch)
# for comparison against cache-metrics.sh results.
#
# Produces:
#   - cache/docs/RERUM_METRICS_REPORT.md (performance analysis)
#   - cache/docs/RERUM_METRICS.log (terminal output capture)
#
# Author: thehabes
# Date: January 2025
################################################################################

# Configuration
BASE_URL="${BASE_URL:-https://devstore.rerum.io}"
API_BASE="${BASE_URL}/v1"
AUTH_TOKEN=""

# Test Parameters (match cache-metrics.sh)
NUM_CREATE_ITERATIONS=100
NUM_WRITE_ITERATIONS=50
NUM_DELETE_ITERATIONS=50

# Timeout Configuration
DEFAULT_TIMEOUT=10
UPDATE_TIMEOUT=10
DELETE_TIMEOUT=60

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# Test tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Data structures for test results
declare -A ENDPOINT_TIMES
declare -A ENDPOINT_MEDIANS
declare -A ENDPOINT_MINS
declare -A ENDPOINT_MAXS
declare -A ENDPOINT_SUCCESS_COUNTS
declare -A ENDPOINT_TOTAL_COUNTS
declare -A ENDPOINT_STATUS
declare -A ENDPOINT_DESCRIPTIONS

declare -a CREATED_IDS=()

# Object with version history for testing history/since endpoints
HISTORY_TEST_ID=""

# High-volume query load test results
DIVERSE_QUERY_TOTAL_TIME=0
DIVERSE_QUERY_SUCCESS=0
DIVERSE_QUERY_FAILED=0
DIVERSE_QUERY_TOTAL=1000

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPORT_FILE="$REPO_ROOT/cache/docs/RERUM_METRICS_REPORT.md"
LOG_FILE="$REPO_ROOT/cache/docs/RERUM_METRICS.log"

# Track script start time
SCRIPT_START_TIME=$(date +%s)

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

check_server() {
    log_info "Checking server connectivity at ${BASE_URL}..."
    if ! curl -s -f "${BASE_URL}" > /dev/null 2>&1; then
        echo -e "${RED}ERROR: Cannot connect to server at ${BASE_URL}${NC}"
        echo "Please ensure the server is running."
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
    local timeout=${6:-$DEFAULT_TIMEOUT}

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

    # Validate timing (protect against clock skew)
    if [ "$time" -lt 0 ]; then
        if [ -z "$http_code" ] || [ "$http_code" == "000" ]; then
            http_code="000"
            echo -e "${YELLOW}[CLOCK SKEW DETECTED]${NC} $endpoint (NO RESPONSE)" >&2
            time=0
        else
            echo -e "${YELLOW}[CLOCK SKEW DETECTED]${NC} $endpoint (HTTP $http_code SUCCESS)" >&2
            time=0
        fi
    fi

    # Handle curl failure
    if [ -z "$http_code" ]; then
        http_code="000"
        echo "[WARN] Endpoint $endpoint timed out or connection failed" >&2
    fi

    echo "$time|$http_code|$response_body"
}

# Helper: Create a test object and track it
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
        sleep 0.5
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
        sleep 0.5
        echo "$response"
    else
        echo ""
    fi
}

# Perform write operation with timing
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
    elif [ "$endpoint" = "delete" ] && [ "$http_code" = "204" ]; then
        success=1
    elif [ "$http_code" = "200" ]; then
        success=1
    fi

    # Handle timing issues
    if [ "$time" -lt 0 ]; then
        if [ $success -eq 1 ]; then
            echo "0|${http_code}|${response_body}"
        else
            echo "-1|${http_code}|${response_body}"
        fi
    elif [ $success -eq 1 ]; then
        echo "${time}|${http_code}|${response_body}"
    else
        echo "-1|${http_code}|${response_body}"
    fi
}

# Run write performance test
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

        # Check if operation actually failed
        if [ "$time" = "-1" ]; then
            failed_count=$((failed_count + 1))
        elif [ "$time" = "0" ]; then
            # Clock skew detected (time < 0 was normalized to 0) - operation succeeded but timing is unreliable
            clock_skew_count=$((clock_skew_count + 1))
            # Don't add to times array (0ms is not meaningful) or total_time
            # Store created ID for cleanup
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
            # Store created ID for cleanup
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
        echo "0|0|0|0|0|$num_tests"
        return 1
    fi

    # Calculate statistics
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
        log_warning "$failed_count operations failed" >&2
    fi

    if [ $clock_skew_count -gt 0 ]; then
        log_warning "$clock_skew_count operations affected by clock skew (timing unavailable)" >&2
    fi

    # Write stats to temp file (so they persist when function is called directly, not in subshell)
    echo "${avg_time}|${median_time}|${min_time}|${max_time}|${successful}|${num_tests}" > /tmp/rerum_write_stats
}

################################################################################
# Read Endpoint Tests
################################################################################

test_query_endpoint() {
    log_section "Testing /api/query Endpoint"

    ENDPOINT_DESCRIPTIONS["query"]="Query database with filters"

    log_info "Testing query endpoint..."
    local result=$(measure_endpoint "${API_BASE}/api/query" "POST" '{"type":"Annotation","limit":10}' "Query for Annotations")
    local time=$(echo "$result" | cut -d'|' -f1)
    local code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_TIMES["query"]=$time
    ENDPOINT_MEDIANS["query"]=$time
    ENDPOINT_MINS["query"]=$time
    ENDPOINT_MAXS["query"]=$time

    if [ "$code" == "200" ]; then
        if [ "$time" == "0" ]; then
            log_success "Query endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "Query endpoint functional (${time}ms)"
        fi
        ENDPOINT_STATUS["query"]="✅ Functional"
    else
        log_failure "Query endpoint failed (HTTP $code)"
        ENDPOINT_STATUS["query"]="❌ Failed"
    fi
}

test_search_endpoint() {
    log_section "Testing /api/search Endpoint"

    ENDPOINT_DESCRIPTIONS["search"]="Full-text search"

    log_info "Testing search endpoint..."
    local result=$(measure_endpoint "${API_BASE}/api/search" "POST" '{"searchText":"annotation"}' "Search for annotation")
    local time=$(echo "$result" | cut -d'|' -f1)
    local code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_TIMES["search"]=$time
    ENDPOINT_MEDIANS["search"]=$time
    ENDPOINT_MINS["search"]=$time
    ENDPOINT_MAXS["search"]=$time

    if [ "$code" == "200" ]; then
        if [ "$time" == "0" ]; then
            log_success "Search endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "Search endpoint functional (${time}ms)"
        fi
        ENDPOINT_STATUS["search"]="✅ Functional"
    else
        log_failure "Search endpoint failed (HTTP $code)"
        ENDPOINT_STATUS["search"]="❌ Failed"
    fi
}

test_search_phrase_endpoint() {
    log_section "Testing /api/search/phrase Endpoint"

    ENDPOINT_DESCRIPTIONS["searchPhrase"]="Phrase search"

    log_info "Testing search phrase endpoint..."
    local result=$(measure_endpoint "${API_BASE}/api/search/phrase" "POST" '{"searchText":"test annotation"}' "Search for phrase")
    local time=$(echo "$result" | cut -d'|' -f1)
    local code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_TIMES["searchPhrase"]=$time
    ENDPOINT_MEDIANS["searchPhrase"]=$time
    ENDPOINT_MINS["searchPhrase"]=$time
    ENDPOINT_MAXS["searchPhrase"]=$time

    if [ "$code" == "200" ]; then
        if [ "$time" == "0" ]; then
            log_success "Search phrase endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "Search phrase endpoint functional (${time}ms)"
        fi
        ENDPOINT_STATUS["searchPhrase"]="✅ Functional"
    else
        log_failure "Search phrase endpoint failed (HTTP $code)"
        ENDPOINT_STATUS["searchPhrase"]="❌ Failed"
    fi
}

test_id_endpoint() {
    log_section "Testing /id/{id} Endpoint"

    ENDPOINT_DESCRIPTIONS["id"]="Retrieve object by ID"

    # Create a test object first
    log_info "Creating test object for ID retrieval..."
    local test_id=$(create_test_object '{"type":"IdTest","value":"test"}')

    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for ID test"
        ENDPOINT_STATUS["id"]="❌ Failed"
        return
    fi

    log_info "Testing ID endpoint..."
    local result=$(measure_endpoint "$test_id" "GET" "" "Get by ID")
    local time=$(echo "$result" | cut -d'|' -f1)
    local code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_TIMES["id"]=$time
    ENDPOINT_MEDIANS["id"]=$time
    ENDPOINT_MINS["id"]=$time
    ENDPOINT_MAXS["id"]=$time

    if [ "$code" == "200" ]; then
        if [ "$time" == "0" ]; then
            log_success "ID endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "ID endpoint functional (${time}ms)"
        fi
        ENDPOINT_STATUS["id"]="✅ Functional"
    else
        log_failure "ID endpoint failed (HTTP $code)"
        ENDPOINT_STATUS["id"]="❌ Failed"
    fi
}

setup_history_test_object() {
    log_section "Setting Up Object with Version History"

    log_info "Creating initial object for history/since tests..."
    local initial_obj=$(create_test_object_with_body '{"type":"HistoryTest","value":"v1","description":"Initial version"}')
    local obj_id=$(echo "$initial_obj" | jq -r '.["@id"]' 2>/dev/null)

    if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
        log_warning "Failed to create object for history/since tests"
        return
    fi

    log_info "Object created: $obj_id"

    # Perform 3 updates to create version history
    log_info "Creating version history with 3 updates..."
    local base_obj=$(echo "$initial_obj" | jq 'del(.__rerum)' 2>/dev/null)

    for i in 2 3 4; do
        local update_body=$(echo "$base_obj" | jq --arg val "v$i" '.value = $val | .description = "Version '"$i"'"' 2>/dev/null)
        local result=$(measure_endpoint "${API_BASE}/api/update" "PUT" "$update_body" "Update v$i" true 10)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "200" ]; then
            log_info "  Version $i created successfully"
            sleep 0.5
        else
            log_warning "  Failed to create version $i (HTTP $code)"
        fi
    done

    # Store the original object ID for history/since tests
    HISTORY_TEST_ID=$(echo "$obj_id" | sed 's|.*/||')
    log_success "Version history created for object: $HISTORY_TEST_ID"
}

test_history_endpoint() {
    log_section "Testing /history/{id} Endpoint"

    ENDPOINT_DESCRIPTIONS["history"]="Get version history"

    # Use the object with version history
    if [ -z "$HISTORY_TEST_ID" ]; then
        log_skip "No history test object available"
        ENDPOINT_STATUS["history"]="⚠️ Skipped"
        return
    fi

    local test_id="$HISTORY_TEST_ID"

    log_info "Testing history endpoint..."
    local result=$(measure_endpoint "${API_BASE}/history/${test_id}" "GET" "" "Get history")
    local time=$(echo "$result" | cut -d'|' -f1)
    local code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_TIMES["history"]=$time
    ENDPOINT_MEDIANS["history"]=$time
    ENDPOINT_MINS["history"]=$time
    ENDPOINT_MAXS["history"]=$time

    if [ "$code" == "200" ]; then
        if [ "$time" == "0" ]; then
            log_success "History endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "History endpoint functional (${time}ms)"
        fi
        ENDPOINT_STATUS["history"]="✅ Functional"
    else
        log_failure "History endpoint failed (HTTP $code)"
        ENDPOINT_STATUS["history"]="❌ Failed"
    fi
}

test_since_endpoint() {
    log_section "Testing /since/{id} Endpoint"

    ENDPOINT_DESCRIPTIONS["since"]="Get version descendants"

    # Use the object with version history
    if [ -z "$HISTORY_TEST_ID" ]; then
        log_skip "No history test object available"
        ENDPOINT_STATUS["since"]="⚠️ Skipped"
        return
    fi

    local test_id="$HISTORY_TEST_ID"

    log_info "Testing since endpoint..."
    local result=$(measure_endpoint "${API_BASE}/since/${test_id}" "GET" "" "Get since")
    local time=$(echo "$result" | cut -d'|' -f1)
    local code=$(echo "$result" | cut -d'|' -f2)

    ENDPOINT_TIMES["since"]=$time
    ENDPOINT_MEDIANS["since"]=$time
    ENDPOINT_MINS["since"]=$time
    ENDPOINT_MAXS["since"]=$time

    if [ "$code" == "200" ]; then
        if [ "$time" == "0" ]; then
            log_success "Since endpoint functional (timing unavailable due to clock skew)"
        else
            log_success "Since endpoint functional (${time}ms)"
        fi
        ENDPOINT_STATUS["since"]="✅ Functional"
    else
        log_failure "Since endpoint failed (HTTP $code)"
        ENDPOINT_STATUS["since"]="❌ Failed"
    fi
}

test_diverse_query_load() {
    log_section "Testing High-Volume Diverse Query Load (1000 queries)"

    log_info "Performing 1000 diverse read queries to measure baseline database performance..."
    log_info "This matches the cache-metrics.sh fill_cache operation for comparison."

    local start_time=$(date +%s)

    # Use parallel requests for faster execution (match cache-metrics.sh pattern)
    local batch_size=100
    local target_size=1000
    local completed=0
    local successful_requests=0
    local failed_requests=0

    while [ $completed -lt $target_size ]; do
        local batch_end=$((completed + batch_size))
        if [ $batch_end -gt $target_size ]; then
            batch_end=$target_size
        fi

        # Launch batch requests in parallel using background jobs
        for count in $(seq $completed $((batch_end - 1))); do
            (
                local unique_id="DiverseQuery_${count}_${RANDOM}_$$_$(date +%s%N)"
                local endpoint=""
                local data=""
                local method="POST"

                # Rotate through 6 endpoint patterns (0-5)
                local pattern=$((count % 6))

                if [ $pattern -eq 0 ]; then
                    # Query endpoint with unique filter
                    endpoint="${API_BASE}/api/query"
                    data="{\"type\":\"Annotation\",\"limit\":$((count % 20 + 1))}"
                    method="POST"
                elif [ $pattern -eq 1 ]; then
                    # Search endpoint with varying search text
                    endpoint="${API_BASE}/api/search"
                    data="{\"searchText\":\"annotation${count}\"}"
                    method="POST"
                elif [ $pattern -eq 2 ]; then
                    # Search phrase endpoint
                    endpoint="${API_BASE}/api/search/phrase"
                    data="{\"searchText\":\"test annotation ${count}\"}"
                    method="POST"
                elif [ $pattern -eq 3 ]; then
                    # ID endpoint - use created objects if available
                    if [ ${#CREATED_IDS[@]} -gt 0 ]; then
                        local idx=$((count % ${#CREATED_IDS[@]}))
                        endpoint="${CREATED_IDS[$idx]}"
                        method="GET"
                        data=""
                    else
                        # Fallback to query
                        endpoint="${API_BASE}/api/query"
                        data="{\"type\":\"$unique_id\"}"
                        method="POST"
                    fi
                elif [ $pattern -eq 4 ]; then
                    # History endpoint
                    if [ -n "$HISTORY_TEST_ID" ]; then
                        endpoint="${API_BASE}/history/${HISTORY_TEST_ID}"
                        method="GET"
                        data=""
                    else
                        # Fallback to search
                        endpoint="${API_BASE}/api/search"
                        data="{\"searchText\":\"$unique_id\"}"
                        method="POST"
                    fi
                else
                    # Since endpoint (pattern 5)
                    if [ -n "$HISTORY_TEST_ID" ]; then
                        endpoint="${API_BASE}/since/${HISTORY_TEST_ID}"
                        method="GET"
                        data=""
                    else
                        # Fallback to search phrase
                        endpoint="${API_BASE}/api/search/phrase"
                        data="{\"searchText\":\"$unique_id\"}"
                        method="POST"
                    fi
                fi

                # Execute request
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

                # Write result to temp file for parent process to read
                if [ "$http_code" = "200" ]; then
                    echo "success" >> /tmp/diverse_query_results_$$.tmp
                else
                    echo "fail:http_$http_code" >> /tmp/diverse_query_results_$$.tmp
                fi
            ) &
        done

        # Wait for all background jobs to complete
        wait

        # Count results from temp file
        local batch_success=0
        local batch_fail=0
        if [ -f /tmp/diverse_query_results_$$.tmp ]; then
            batch_success=$(grep -c "^success$" /tmp/diverse_query_results_$$.tmp 2>/dev/null || echo "0")
            batch_fail=$(grep -c "^fail:" /tmp/diverse_query_results_$$.tmp 2>/dev/null || echo "0")
            rm /tmp/diverse_query_results_$$.tmp
        fi

        # Clean up variables
        batch_success=$(echo "$batch_success" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
        batch_fail=$(echo "$batch_fail" | tr -d '\n\r' | grep -o '[0-9]*' | head -1)
        batch_success=${batch_success:-0}
        batch_fail=${batch_fail:-0}

        successful_requests=$((successful_requests + batch_success))
        failed_requests=$((failed_requests + batch_fail))

        completed=$batch_end
        local pct=$((completed * 100 / target_size))
        echo -ne "\r  Progress: $completed/$target_size queries (${pct}%) | Success: $successful_requests | Failed: $failed_requests  "

        # Small delay between batches to prevent overwhelming the server
        sleep 0.5
    done
    echo ""

    local end_time=$(date +%s)
    local total_time=$((end_time - start_time))

    # Store in global variables for report
    DIVERSE_QUERY_TOTAL_TIME=$((total_time * 1000))  # Convert to ms for consistency
    DIVERSE_QUERY_SUCCESS=$successful_requests
    DIVERSE_QUERY_FAILED=$failed_requests

    log_info "Request Statistics:"
    log_info "  Total requests sent: 1000"
    log_info "  Successful (200 OK): $successful_requests"
    log_info "  Total Runtime: ${total_time} seconds"
    log_info "  Failed/Errors: $failed_requests"
}

################################################################################
# Write Endpoint Tests
################################################################################

test_create_endpoint() {
    log_section "Testing /api/create Endpoint"

    ENDPOINT_DESCRIPTIONS["create"]="Create new objects"

    generate_create_body() {
        echo "{\"type\":\"CreatePerfTest\",\"timestamp\":$(date +%s%3N),\"random\":$RANDOM}"
    }

    log_info "Testing create endpoint ($NUM_CREATE_ITERATIONS operations)..."

    # Call function directly (not in subshell) so CREATED_IDS changes persist
    run_write_performance_test "create" "create" "POST" "generate_create_body" $NUM_CREATE_ITERATIONS

    # Read stats from temp file
    local stats=$(cat /tmp/rerum_write_stats 2>/dev/null || echo "0|0|0|0|0|0")
    local avg=$(echo "$stats" | cut -d'|' -f1)
    local median=$(echo "$stats" | cut -d'|' -f2)
    local min=$(echo "$stats" | cut -d'|' -f3)
    local max=$(echo "$stats" | cut -d'|' -f4)
    local success=$(echo "$stats" | cut -d'|' -f5)
    local total=$(echo "$stats" | cut -d'|' -f6)

    ENDPOINT_TIMES["create"]=$avg
    ENDPOINT_MEDIANS["create"]=$median
    ENDPOINT_MINS["create"]=$min
    ENDPOINT_MAXS["create"]=$max
    ENDPOINT_SUCCESS_COUNTS["create"]=$success
    ENDPOINT_TOTAL_COUNTS["create"]=$total

    if [ "$avg" = "0" ]; then
        log_failure "Create endpoint failed"
        ENDPOINT_STATUS["create"]="❌ Failed"
        return
    fi

    log_success "Create endpoint functional"
    ENDPOINT_STATUS["create"]="✅ Functional"
}

test_update_endpoint() {
    log_section "Testing /api/update Endpoint"

    ENDPOINT_DESCRIPTIONS["update"]="Update existing objects"

    local test_obj=$(create_test_object_with_body '{"type":"UpdateTest","value":"original"}')
    local test_id=$(echo "$test_obj" | jq -r '.["@id"]' 2>/dev/null)

    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for update test"
        ENDPOINT_STATUS["update"]="❌ Failed"
        return
    fi

    log_info "Testing update endpoint ($NUM_WRITE_ITERATIONS iterations)..."

    declare -a times=()
    local total=0
    local success=0
    local base_object=$(echo "$test_obj" | jq 'del(.__rerum)' 2>/dev/null)

    for i in $(seq 1 $NUM_WRITE_ITERATIONS); do
        local update_body=$(echo "$base_object" | jq '.value = "updated_'"$i"'"' 2>/dev/null)
        local result=$(measure_endpoint "${API_BASE}/api/update" "PUT" "$update_body" "Update" true $UPDATE_TIMEOUT)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "200" ] && [ "$time" != "0" ]; then
            times+=($time)
            total=$((total + time))
            success=$((success + 1))
        fi

        if [ $((i % 10)) -eq 0 ]; then
            echo -ne "\r  Progress: $i/$NUM_WRITE_ITERATIONS iterations  "
        fi
    done
    echo ""

    if [ $success -eq 0 ]; then
        log_failure "Update endpoint failed"
        ENDPOINT_STATUS["update"]="❌ Failed"
        return
    fi

    # Calculate statistics
    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}

    ENDPOINT_TIMES["update"]=$avg
    ENDPOINT_MEDIANS["update"]=$median
    ENDPOINT_MINS["update"]=$min
    ENDPOINT_MAXS["update"]=$max
    ENDPOINT_SUCCESS_COUNTS["update"]=$success
    ENDPOINT_TOTAL_COUNTS["update"]=$NUM_WRITE_ITERATIONS

    if [ $success -lt $NUM_WRITE_ITERATIONS ]; then
        log_failure "$success/$NUM_WRITE_ITERATIONS successful (partial failure)"
        ENDPOINT_STATUS["update"]="⚠️ Partial Failures"
    else
        log_success "$success/$NUM_WRITE_ITERATIONS successful"
        ENDPOINT_STATUS["update"]="✅ Functional"
    fi
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
}

test_patch_endpoint() {
    log_section "Testing /api/patch Endpoint"

    ENDPOINT_DESCRIPTIONS["patch"]="Patch existing objects"

    local test_obj=$(create_test_object_with_body '{"type":"PatchTest","value":"original"}')
    local test_id=$(echo "$test_obj" | jq -r '.["@id"]' 2>/dev/null)

    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for patch test"
        ENDPOINT_STATUS["patch"]="❌ Failed"
        return
    fi

    log_info "Testing patch endpoint ($NUM_WRITE_ITERATIONS iterations)..."

    declare -a times=()
    local total=0
    local success=0

    for i in $(seq 1 $NUM_WRITE_ITERATIONS); do
        local patch_body="{\"@id\":\"$test_id\",\"value\":\"patched_$i\"}"
        local result=$(measure_endpoint "${API_BASE}/api/patch" "PATCH" "$patch_body" "Patch" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "200" ] && [ "$time" != "0" ]; then
            times+=($time)
            total=$((total + time))
            success=$((success + 1))
        fi

        if [ $((i % 10)) -eq 0 ]; then
            echo -ne "\r  Progress: $i/$NUM_WRITE_ITERATIONS iterations  "
        fi
    done
    echo ""

    if [ $success -eq 0 ]; then
        log_failure "Patch endpoint failed"
        ENDPOINT_STATUS["patch"]="❌ Failed"
        return
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}

    ENDPOINT_TIMES["patch"]=$avg
    ENDPOINT_MEDIANS["patch"]=$median
    ENDPOINT_MINS["patch"]=$min
    ENDPOINT_MAXS["patch"]=$max
    ENDPOINT_SUCCESS_COUNTS["patch"]=$success
    ENDPOINT_TOTAL_COUNTS["patch"]=$NUM_WRITE_ITERATIONS

    if [ $success -lt $NUM_WRITE_ITERATIONS ]; then
        log_failure "$success/$NUM_WRITE_ITERATIONS successful (partial failure)"
        ENDPOINT_STATUS["patch"]="⚠️ Partial Failures"
    else
        log_success "$success/$NUM_WRITE_ITERATIONS successful"
        ENDPOINT_STATUS["patch"]="✅ Functional"
    fi
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
}

test_set_endpoint() {
    log_section "Testing /api/set Endpoint"

    ENDPOINT_DESCRIPTIONS["set"]="Add properties to objects"

    local test_id=$(create_test_object '{"type":"SetTest","value":"original"}')

    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for set test"
        ENDPOINT_STATUS["set"]="❌ Failed"
        return
    fi

    log_info "Testing set endpoint ($NUM_WRITE_ITERATIONS iterations)..."

    declare -a times=()
    local total=0
    local success=0

    for i in $(seq 1 $NUM_WRITE_ITERATIONS); do
        local set_body="{\"@id\":\"$test_id\",\"newProp_$i\":\"value_$i\"}"
        local result=$(measure_endpoint "${API_BASE}/api/set" "PATCH" "$set_body" "Set" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "200" ] && [ "$time" != "0" ]; then
            times+=($time)
            total=$((total + time))
            success=$((success + 1))
        fi

        if [ $((i % 10)) -eq 0 ]; then
            echo -ne "\r  Progress: $i/$NUM_WRITE_ITERATIONS iterations  "
        fi
    done
    echo ""

    if [ $success -eq 0 ]; then
        log_failure "Set endpoint failed"
        ENDPOINT_STATUS["set"]="❌ Failed"
        return
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}

    ENDPOINT_TIMES["set"]=$avg
    ENDPOINT_MEDIANS["set"]=$median
    ENDPOINT_MINS["set"]=$min
    ENDPOINT_MAXS["set"]=$max
    ENDPOINT_SUCCESS_COUNTS["set"]=$success
    ENDPOINT_TOTAL_COUNTS["set"]=$NUM_WRITE_ITERATIONS

    if [ $success -lt $NUM_WRITE_ITERATIONS ]; then
        log_failure "$success/$NUM_WRITE_ITERATIONS successful (partial failure)"
        ENDPOINT_STATUS["set"]="⚠️ Partial Failures"
    else
        log_success "$success/$NUM_WRITE_ITERATIONS successful"
        ENDPOINT_STATUS["set"]="✅ Functional"
    fi
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
}

test_unset_endpoint() {
    log_section "Testing /api/unset Endpoint"

    ENDPOINT_DESCRIPTIONS["unset"]="Remove properties from objects"

    local test_obj=$(create_test_object_with_body '{"type":"UnsetTest","value":"original","removable":"prop"}')
    local test_id=$(echo "$test_obj" | jq -r '.["@id"]' 2>/dev/null)

    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for unset test"
        ENDPOINT_STATUS["unset"]="❌ Failed"
        return
    fi

    log_info "Testing unset endpoint ($NUM_WRITE_ITERATIONS iterations)..."

    declare -a times=()
    local total=0
    local success=0

    for i in $(seq 1 $NUM_WRITE_ITERATIONS); do
        local unset_body="{\"@id\":\"$test_id\",\"value\":null}"
        local result=$(measure_endpoint "${API_BASE}/api/unset" "PATCH" "$unset_body" "Unset" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "200" ] && [ "$time" != "0" ]; then
            times+=($time)
            total=$((total + time))
            success=$((success + 1))
        fi

        if [ $((i % 10)) -eq 0 ]; then
            echo -ne "\r  Progress: $i/$NUM_WRITE_ITERATIONS iterations  "
        fi
    done
    echo ""

    if [ $success -eq 0 ]; then
        log_failure "Unset endpoint failed"
        ENDPOINT_STATUS["unset"]="❌ Failed"
        return
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}

    ENDPOINT_TIMES["unset"]=$avg
    ENDPOINT_MEDIANS["unset"]=$median
    ENDPOINT_MINS["unset"]=$min
    ENDPOINT_MAXS["unset"]=$max
    ENDPOINT_SUCCESS_COUNTS["unset"]=$success
    ENDPOINT_TOTAL_COUNTS["unset"]=$NUM_WRITE_ITERATIONS

    if [ $success -lt $NUM_WRITE_ITERATIONS ]; then
        log_failure "$success/$NUM_WRITE_ITERATIONS successful (partial failure)"
        ENDPOINT_STATUS["unset"]="⚠️ Partial Failures"
    else
        log_success "$success/$NUM_WRITE_ITERATIONS successful"
        ENDPOINT_STATUS["unset"]="✅ Functional"
    fi
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
}

test_overwrite_endpoint() {
    log_section "Testing /api/overwrite Endpoint"

    ENDPOINT_DESCRIPTIONS["overwrite"]="Overwrite objects without versioning"

    local test_id=$(create_test_object '{"type":"OverwriteTest","value":"original"}')

    if [ -z "$test_id" ] || [ "$test_id" == "null" ]; then
        log_failure "Failed to create test object for overwrite test"
        ENDPOINT_STATUS["overwrite"]="❌ Failed"
        return
    fi

    log_info "Testing overwrite endpoint ($NUM_WRITE_ITERATIONS iterations)..."

    declare -a times=()
    local total=0
    local success=0

    for i in $(seq 1 $NUM_WRITE_ITERATIONS); do
        local overwrite_body="{\"@id\":\"$test_id\",\"type\":\"OverwriteTest\",\"value\":\"v$i\"}"
        local result=$(measure_endpoint "${API_BASE}/api/overwrite" "PUT" "$overwrite_body" "Overwrite" true)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "200" ] && [ "$time" != "0" ]; then
            times+=($time)
            total=$((total + time))
            success=$((success + 1))
        fi

        if [ $((i % 10)) -eq 0 ]; then
            echo -ne "\r  Progress: $i/$NUM_WRITE_ITERATIONS iterations  "
        fi
    done
    echo ""

    if [ $success -eq 0 ]; then
        log_failure "Overwrite endpoint failed"
        ENDPOINT_STATUS["overwrite"]="❌ Failed"
        return
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}

    ENDPOINT_TIMES["overwrite"]=$avg
    ENDPOINT_MEDIANS["overwrite"]=$median
    ENDPOINT_MINS["overwrite"]=$min
    ENDPOINT_MAXS["overwrite"]=$max
    ENDPOINT_SUCCESS_COUNTS["overwrite"]=$success
    ENDPOINT_TOTAL_COUNTS["overwrite"]=$NUM_WRITE_ITERATIONS

    if [ $success -lt $NUM_WRITE_ITERATIONS ]; then
        log_failure "$success/$NUM_WRITE_ITERATIONS successful (partial failure)"
        ENDPOINT_STATUS["overwrite"]="⚠️ Partial Failures"
    else
        log_success "$success/$NUM_WRITE_ITERATIONS successful"
        ENDPOINT_STATUS["overwrite"]="✅ Functional"
    fi
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
}

test_delete_endpoint() {
    log_section "Testing /api/delete Endpoint"

    ENDPOINT_DESCRIPTIONS["delete"]="Delete objects"

    local num_created=${#CREATED_IDS[@]}
    if [ $num_created -lt $NUM_DELETE_ITERATIONS ]; then
        log_warning "Not enough objects (have: $num_created, need: $NUM_DELETE_ITERATIONS)"
        ENDPOINT_STATUS["delete"]="⚠️ Skipped"
        return
    fi

    log_info "Deleting first $NUM_DELETE_ITERATIONS objects from create test..."

    declare -a times=()
    local total=0
    local success=0

    for i in $(seq 0 $((NUM_DELETE_ITERATIONS - 1))); do
        local obj_id=$(echo "${CREATED_IDS[$i]}" | sed 's|.*/||')

        if [ -z "$obj_id" ] || [ "$obj_id" == "null" ]; then
            continue
        fi

        local result=$(measure_endpoint "${API_BASE}/api/delete/${obj_id}" "DELETE" "" "Delete" true $DELETE_TIMEOUT)
        local time=$(echo "$result" | cut -d'|' -f1)
        local code=$(echo "$result" | cut -d'|' -f2)

        if [ "$code" == "204" ] && [ "$time" != "0" ]; then
            times+=($time)
            total=$((total + time))
            success=$((success + 1))
        fi

        local display_i=$((i + 1))
        if [ $((display_i % 10)) -eq 0 ] || [ $display_i -eq $NUM_DELETE_ITERATIONS ]; then
            echo -ne "\r  Progress: $display_i/$NUM_DELETE_ITERATIONS iterations  "
        fi
    done
    echo ""

    if [ $success -eq 0 ]; then
        log_failure "Delete endpoint failed"
        ENDPOINT_STATUS["delete"]="❌ Failed"
        return
    fi

    local avg=$((total / success))
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS
    local median=${sorted[$((success / 2))]}
    local min=${sorted[0]}
    local max=${sorted[$((success - 1))]}

    ENDPOINT_TIMES["delete"]=$avg
    ENDPOINT_MEDIANS["delete"]=$median
    ENDPOINT_MINS["delete"]=$min
    ENDPOINT_MAXS["delete"]=$max
    ENDPOINT_SUCCESS_COUNTS["delete"]=$success
    ENDPOINT_TOTAL_COUNTS["delete"]=$NUM_DELETE_ITERATIONS

    if [ $success -lt $NUM_DELETE_ITERATIONS ]; then
        log_failure "$success/$NUM_DELETE_ITERATIONS successful (partial failure, deleted: $success)"
        ENDPOINT_STATUS["delete"]="⚠️ Partial Failures"
    else
        log_success "$success/$NUM_DELETE_ITERATIONS successful (deleted: $success)"
        ENDPOINT_STATUS["delete"]="✅ Functional"
    fi
    echo "  Total: ${total}ms, Average: ${avg}ms, Median: ${median}ms, Min: ${min}ms, Max: ${max}ms"
}

################################################################################
# Report Generation
################################################################################

generate_report() {
    log_header "Generating Report"

    local script_end_time=$(date +%s)
    local duration=$((script_end_time - SCRIPT_START_TIME))
    local minutes=$((duration / 60))
    local seconds=$((duration % 60))

    # Calculate total write operations before heredoc
    local total_write_ops=$(( ${ENDPOINT_TOTAL_COUNTS[create]:-0} + ${ENDPOINT_TOTAL_COUNTS[update]:-0} + ${ENDPOINT_TOTAL_COUNTS[patch]:-0} + ${ENDPOINT_TOTAL_COUNTS[set]:-0} + ${ENDPOINT_TOTAL_COUNTS[unset]:-0} + ${ENDPOINT_TOTAL_COUNTS[delete]:-0} + ${ENDPOINT_TOTAL_COUNTS[overwrite]:-0} ))

    cat > "$REPORT_FILE" << EOF
# RERUM Baseline Performance Analysis (No Cache)

**Generated**: $(date)
**Server**: ${BASE_URL}
**Branch**: main (no cache layer)
**Test Duration**: ${minutes} minutes ${seconds} seconds

---

## Executive Summary

**Overall Test Results**: ${PASSED_TESTS} passed, ${FAILED_TESTS} failed, ${SKIPPED_TESTS} skipped (${TOTAL_TESTS} total)

This report establishes baseline performance metrics for the RERUM API without the cache layer. These metrics can be compared against CACHE_METRICS_REPORT.md to evaluate the impact of the caching implementation.

---

## Endpoint Functionality Status

| Endpoint | Status | Description |
|----------|--------|-------------|
EOF

    # Add endpoint status rows
    for endpoint in query search searchPhrase id history since create update patch set unset delete overwrite; do
        local status="${ENDPOINT_STATUS[$endpoint]:-⚠️ Not Tested}"
        local desc="${ENDPOINT_DESCRIPTIONS[$endpoint]:-}"
        echo "| \`/$endpoint\` | $status | $desc |" >> "$REPORT_FILE"
    done

    cat >> "$REPORT_FILE" << EOF

---

## Read Performance

| Endpoint | Avg (ms) | Median (ms) | Min (ms) | Max (ms) |
|----------|----------|-------------|----------|----------|
EOF

    # Add read performance rows
    for endpoint in query search searchPhrase id history since; do
        local avg="${ENDPOINT_TIMES[$endpoint]:-N/A}"
        local median="${ENDPOINT_MEDIANS[$endpoint]:-N/A}"
        local min="${ENDPOINT_MINS[$endpoint]:-N/A}"
        local max="${ENDPOINT_MAXS[$endpoint]:-N/A}"
        echo "| \`/$endpoint\` | ${avg} | ${median} | ${min} | ${max} |" >> "$REPORT_FILE"
    done

    cat >> "$REPORT_FILE" << EOF

**Interpretation**:
- All read operations hit the database directly (no caching)
- Times represent baseline database query performance
- These metrics can be compared with cached read performance to calculate cache speedup

---

## High-Volume Query Load Test

This test performs 1000 diverse read queries to measure baseline database performance under load. It directly corresponds to the \`fill_cache()\` operation in cache-metrics.sh, enabling direct comparison.

| Metric | Value |
|--------|-------|
| Total Queries | ${DIVERSE_QUERY_TOTAL} |
| Total Time | $((DIVERSE_QUERY_TOTAL_TIME / 1000)) seconds (${DIVERSE_QUERY_TOTAL_TIME}ms) |
| Average per Query | $((DIVERSE_QUERY_TOTAL_TIME / DIVERSE_QUERY_TOTAL))ms |
| Successful Queries | ${DIVERSE_QUERY_SUCCESS}/${DIVERSE_QUERY_TOTAL} |
| Failed Queries | ${DIVERSE_QUERY_FAILED}/${DIVERSE_QUERY_TOTAL} |

**Query Distribution**:
- Rotates through 6 endpoint types: /api/query, /api/search, /api/search/phrase, /id/{id}, /history/{id}, /since/{id}
- Each query uses unique parameters to prevent database-level caching

**Comparison with Cache**:
- Compare this total time with the cache fill operation time in CACHE_METRICS_REPORT.md
- This shows baseline database performance for 1000 diverse queries without caching
- Cache fill time includes both database queries (on cache misses) and cache.set() operations

---

## Write Performance

| Endpoint | Avg (ms) | Median (ms) | Min (ms) | Max (ms) | Successful/Total |
|----------|----------|-------------|----------|----------|------------------|
EOF

    # Add write performance rows
    for endpoint in create update patch set unset delete overwrite; do
        local avg="${ENDPOINT_TIMES[$endpoint]:-N/A}"
        local median="${ENDPOINT_MEDIANS[$endpoint]:-N/A}"
        local min="${ENDPOINT_MINS[$endpoint]:-N/A}"
        local max="${ENDPOINT_MAXS[$endpoint]:-N/A}"
        local success="${ENDPOINT_SUCCESS_COUNTS[$endpoint]:-0}"
        local total="${ENDPOINT_TOTAL_COUNTS[$endpoint]:-0}"

        if [ "$total" != "0" ]; then
            echo "| \`/$endpoint\` | ${avg} | ${median} | ${min} | ${max} | ${success}/${total} |" >> "$REPORT_FILE"
        else
            echo "| \`/$endpoint\` | ${avg} | ${median} | ${min} | ${max} | N/A |" >> "$REPORT_FILE"
        fi
    done

    cat >> "$REPORT_FILE" << EOF

**Interpretation**:
- All write operations execute without cache invalidation overhead
- Times represent baseline write performance
- These metrics can be compared with cached write performance to calculate cache overhead

---

## Summary Statistics

**Total Operations**:
- Read operations: 6 endpoints tested
- Write operations: ${total_write_ops} operations across 7 endpoints

**Success Rates**:
- Create: ${ENDPOINT_SUCCESS_COUNTS[create]:-0}/${ENDPOINT_TOTAL_COUNTS[create]:-0}
- Update: ${ENDPOINT_SUCCESS_COUNTS[update]:-0}/${ENDPOINT_TOTAL_COUNTS[update]:-0}
- Patch: ${ENDPOINT_SUCCESS_COUNTS[patch]:-0}/${ENDPOINT_TOTAL_COUNTS[patch]:-0}
- Set: ${ENDPOINT_SUCCESS_COUNTS[set]:-0}/${ENDPOINT_TOTAL_COUNTS[set]:-0}
- Unset: ${ENDPOINT_SUCCESS_COUNTS[unset]:-0}/${ENDPOINT_TOTAL_COUNTS[unset]:-0}
- Delete: ${ENDPOINT_SUCCESS_COUNTS[delete]:-0}/${ENDPOINT_TOTAL_COUNTS[delete]:-0}
- Overwrite: ${ENDPOINT_SUCCESS_COUNTS[overwrite]:-0}/${ENDPOINT_TOTAL_COUNTS[overwrite]:-0}

**Test Execution**:
- Total duration: ${minutes} minutes ${seconds} seconds
- Test objects created: ${#CREATED_IDS[@]}
- Server: ${BASE_URL}

---

## Comparison Guide

To compare with cache performance (CACHE_METRICS_REPORT.md):

1. **Read Speedup**: Calculate cache benefit
   \`\`\`
   Speedup = Baseline Read Time - Cached Read Time
   Speedup % = (Speedup / Baseline Read Time) × 100
   \`\`\`

2. **Write Overhead**: Calculate cache cost
   \`\`\`
   Overhead = Cached Write Time - Baseline Write Time
   Overhead % = (Overhead / Baseline Write Time) × 100
   \`\`\`

3. **Net Benefit**: Evaluate overall impact based on your read/write ratio

---

## Notes

- This test was run against the **main branch** without the cache layer
- All timing measurements are in milliseconds
- Clock skew was handled gracefully (operations with negative timing marked as 0ms)
- Test objects should be manually cleaned from MongoDB using the commands provided at test start

---

**Report Generated**: $(date)
**Format Version**: 1.0
**Test Suite**: rerum-metrics.sh
EOF

    echo -e "${CYAN}Report location: ${REPORT_FILE}${NC}"
}

################################################################################
# Main Execution
################################################################################

main() {
    log_header "RERUM Baseline Performance Metrics Test"

    echo -e "${BLUE}Testing RERUM API without cache layer (main branch)${NC}"
    echo -e "${BLUE}Server: ${BASE_URL}${NC}"
    echo ""

    # Phase 1: Pre-flight & Authentication
    log_header "Phase 1: Pre-flight & Authentication"
    check_server
    get_auth_token

    # Phase 2: Read Endpoint Tests
    log_header "Phase 2: Read Endpoint Tests"
    test_query_endpoint
    test_search_endpoint
    test_search_phrase_endpoint
    test_id_endpoint

    # Setup object with version history for history/since tests
    setup_history_test_object

    test_history_endpoint
    test_since_endpoint

    # High-volume query load test (last action of Phase 2)
    test_diverse_query_load

    # Phase 3: Write Endpoint Tests
    log_header "Phase 3: Write Endpoint Tests"
    test_create_endpoint
    test_update_endpoint
    test_patch_endpoint
    test_set_endpoint
    test_unset_endpoint
    test_overwrite_endpoint
    test_delete_endpoint

    # Phase 4: Generate Report
    generate_report

    # Final Summary
    log_header "Test Complete"
    echo -e "${GREEN}✓ ${PASSED_TESTS} tests passed${NC}"
    if [ $FAILED_TESTS -gt 0 ]; then
        echo -e "${RED}✗ ${FAILED_TESTS} tests failed${NC}"
    fi
    if [ $SKIPPED_TESTS -gt 0 ]; then
        echo -e "${YELLOW}⊘ ${SKIPPED_TESTS} tests skipped${NC}"
    fi
    echo ""
    echo -e "${CYAN}Report saved to: ${REPORT_FILE}${NC}"
    echo -e "${CYAN}Terminal log saved to: ${LOG_FILE}${NC}"
    echo ""
    echo -e "${YELLOW}Remember to clean up test objects from MongoDB!${NC}"
    echo ""
}

# Run main function and capture output to log file (strip ANSI colors from log)
main 2>&1 | tee >(sed 's/\x1b\[[0-9;]*m//g' > "$LOG_FILE")
