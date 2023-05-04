FROM alpine:latest

RUN apk --no-cache --update --upgrade add tor \
    && mv /etc/tor/torrc.sample  /etc/tor/torrc \
    && sed -i \
        -e 's/#SOCKSPort 192.168.0.1:9100/SOCKSPort 0.0.0.0:9050/g' \
        -e 's/#ControlPort 9051/ControlPort 9051/g' \
        /etc/tor/torrc
RUN chown root:root /var/lib/tor

ENTRYPOINT tor

EXPOSE 9050/tcp 9051/tcp

HEALTHCHECK --interval=10s --timeout=3s \
    CMD curl -s --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/ | grep -q Congratulations || exit 1
