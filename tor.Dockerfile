FROM alpine:latest

RUN apk --no-cache --update --upgrade add tor curl grep \
    && mv /etc/tor/torrc.sample  /etc/tor/torrc \
    && sed -i \
        -e 's/#SOCKSPort 192.168.0.1:9100/SOCKSPort 0.0.0.0:9050/g' \
        /etc/tor/torrc \
    && chown -R tor /var/lib/tor

USER tor
ENTRYPOINT tor

EXPOSE 9050/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=1 \
    CMD curl -x socks5h://127.0.0.1:9050 -s http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion | grep -qm1 Histats
