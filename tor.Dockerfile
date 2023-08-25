FROM alpine:latest

RUN apk --no-cache --update --upgrade add tor \
    && mv /etc/tor/torrc.sample  /etc/tor/torrc \
    && sed -i \
        -e 's/#SOCKSPort 192.168.0.1:9100/SOCKSPort 0.0.0.0:9050/g' \
        /etc/tor/torrc \
    && chown -R tor /var/lib/tor

USER tor
ENTRYPOINT tor

EXPOSE 9050/tcp

HEALTHCHECK --interval=120s --timeout=30s --start-period=60s --retries=5 \
            CMD curl --silent --location --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/?lang=en_US | \
            grep -qm1 Congratulations
