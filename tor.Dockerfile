FROM alpine:latest

COPY renew-tor.sh /usr/local/bin/check-and-renew.sh

RUN apk --no-cache --update --upgrade add tor curl grep netcat-openbsd \
    && mv /etc/tor/torrc.sample  /etc/tor/torrc \
    && sed -i \
        -e 's/#SOCKSPort 192.168.0.1:9100/SOCKSPort 0.0.0.0:9050/g' \
        -e 's/#ControlPort 9051/ControlPort 9051/g' \
        /etc/tor/torrc \
    && chmod +x /usr/local/bin/check-and-renew.sh

USER tor
ENTRYPOINT tor & /usr/local/bin/check-and-renew.sh

EXPOSE 9050/tcp

HEALTHCHECK --interval=60s --timeout=15s --start-period=20s \
    CMD curl -s --socks5 127.0.0.1:9050 'https://check.torproject.org/api/ip' | grep -qm1 -E '"IsTor"\s*:\s*true'
