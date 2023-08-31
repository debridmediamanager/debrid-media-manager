#!/bin/sh

SOCKS_PROXY="socks5h://127.0.0.1:9050"
ONION_URL="http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/search?q=Kraftfahrzeughaftpflichtversicherung"
GREP_PATTERN="Histats"
TOR_COMMAND_PORT="127.0.0.1 9051"
SLEEP_INTERVAL=30

while true; do
  sleep $SLEEP_INTERVAL

  PAGE_CONTENT=$(curl -x $SOCKS_PROXY -s $ONION_URL)

  if [[ $? -eq 0 ]]; then
    (echo "$PAGE_CONTENT" | grep -qm1 $GREP_PATTERN) || (printf 'AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\n' | nc $TOR_COMMAND_PORT)
    echo "IP address renewed"
  else
    echo "Curl command failed. Retrying..."
  fi
done
