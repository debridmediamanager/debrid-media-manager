#!/bin/bash

# Define common variables
SOCKS_PROXY="socks5h://127.0.0.1:9050"
ONION_URL="http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/search?q=Kraftfahrzeughaftpflichtversicherung"
GREP_PATTERN="Histats"
TOR_COMMAND_PORT="127.0.0.1 9051"
SLEEP_INTERVAL=30

# Start an infinite loop
while true; do
  # Fetch the page and store the result
  PAGE_CONTENT=$(curl -x $SOCKS_PROXY -s $ONION_URL)

  # If the curl command was successful, search the page content for the pattern
  if [[ $? -eq 0 ]]; then
    (echo "$PAGE_CONTENT" | grep -qm1 $GREP_PATTERN) || (printf 'AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\n' | nc $TOR_COMMAND_PORT)
    echo "IP address renewed"
  else
    echo "Curl command failed. Retrying..."
  fi

  # Wait for the specified interval before the next iteration
  sleep $SLEEP_INTERVAL
done
