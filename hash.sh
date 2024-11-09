#!/bin/bash

# Original URL and headers
BASE_URL="https://app.real-debrid.com/rest/1.0/torrents/instantAvailability"
HASHES="1a7afcc14c47fd3859c001ddc8ec6b6003083b45/d468ce2e1d9c78d3a6974ae8e2cff5a1b2d7940d/bcd4b4bb9a153848852d1bef2836e7a78f06ebe6/615e27a5a32ada9834f1ff9c80e6fefd4a2166a8/8548aada00ecd51d8787d77b6218151deee0d7d9/07c24302bd9838e32819c24089a080184b6e6552/07fd8a8c89d96f18e4de0a9020327bb74b5ee1c2/a44e2766d200f70e9eef1e711027f4d1db6ee23f/d81094be2afb21d56df27b81418de5797677c49b/94c3bfe2b37d96a557a94ef6bbc6965e85f024ec/8140e53707162d58e14c38f75fd243ec866f80d2/34241ad689fd324bd0c3a0a921abb1a9c819c135/7c72e556e503eca50c7c3d9ee2d0c99c2218c7e7/0efd33faf58411688a1f0d681e41c4928a91e76e/1c52869f299395a596f84dbb2720a8c3ab442e9a/1020fcb58452e68888909be147f9b3b28e946ba8/2a2510a0dd9e7a9c413d96b2bd7206275fa8ff6c/0915e033a5863e9a25b15d98cbcd35e70613311b/20182ab46b7178c94c3d136f51e02412cef1a3b0/09df1ef85571aafd032303cee997635a00640a3b"
AUTH_TOKEN="XZ4KLVOIIU272R7ID2EAH4AONVASQB3TR3RJW73THBW3IKA36BEQ"
AUTH_HEADER="authorization: Bearer $AUTH_TOKEN"

# Function to generate a random hash (40 characters hex)
function random_hash() {
    head -c 20 /dev/urandom | xxd -p
}

# Function to call the API with a given list of hashes
function make_request() {
    local random_suffix=$(random_hash)
    curl -s "$BASE_URL/$1/$random_suffix?_t=$(date +%s%3N)" -H "$AUTH_HEADER"
}

# Split hashes into an array
IFS='/' read -r -a HASH_ARRAY <<< "$HASHES"

# Try removing three hashes at a time
for ((i = 0; i < ${#HASH_ARRAY[@]} - 2; i++)); do
    for ((j = i + 1; j < ${#HASH_ARRAY[@]} - 1; j++)); do
        for ((k = j + 1; k < ${#HASH_ARRAY[@]}; k++)); do
            # Create a temporary array without the three selected hashes
            TEMP_ARRAY=("${HASH_ARRAY[@]}")
            REMOVED_HASH1="${TEMP_ARRAY[$i]}"
            REMOVED_HASH2="${TEMP_ARRAY[$j]}"
            REMOVED_HASH3="${TEMP_ARRAY[$k]}"
            
            # Remove from highest index to lowest to maintain array indices
            unset 'TEMP_ARRAY[$k]'
            unset 'TEMP_ARRAY[$j]'
            unset 'TEMP_ARRAY[$i]'
            TEMP_ARRAY=("${TEMP_ARRAY[@]}")

            # Join remaining hashes
            TEST_HASHES=$(IFS=/; echo "${TEMP_ARRAY[*]}")
            
            # Make the request
            RESPONSE=$(make_request "$TEST_HASHES")

            # show path and response
            echo "Path: $TEST_HASHES, Response: $RESPONSE"

            # Check if the response is non-empty using jq
            if [[ -n "$RESPONSE" ]] && ! echo "$RESPONSE" | jq -e 'length == 0' >/dev/null; then
                echo "Success with response: $RESPONSE"
                exit 0
            fi
        done
    done
done

# If no valid response is found
echo "No non-empty response found."
exit 1

