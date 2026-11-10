FROM alpine:latest

RUN apk --no-cache --update --upgrade add tor curl grep netcat-openbsd jq \
    && mv /etc/tor/torrc.sample  /etc/tor/torrc \
    && sed -i \
        -e 's/#SOCKSPort 192.168.0.1:9100/SOCKSPort 0.0.0.0:9050/g' \
        -e 's/#ControlPort 9051/ControlPort 9051/g' \
        /etc/tor/torrc

COPY renew-tor.sh /etc/tor/
RUN chmod +x /etc/tor/renew-tor.sh

USER tor
ENTRYPOINT sh -c "/etc/tor/renew-tor.sh"

EXPOSE 9050/tcp

# Ask Tor itself whether it has a circuit rather than fetch check.torproject.org
# through it: that outside site's answer had Swarm kill Tor 4 times in 3 days
# (2026-11-08 to 11-10), each restart costing a minute of bootstrap. A Tor the
# network refuses (stale 0.4.8.16, 2026-10-30) builds no circuit and still fails.
HEALTHCHECK --interval=60s --timeout=15s --start-period=20s \
    CMD printf 'AUTHENTICATE ""\r\nGETINFO status/circuit-established\r\nQUIT\r\n' | nc -w 5 127.0.0.1 9051 | grep -q 'circuit-established=1'
