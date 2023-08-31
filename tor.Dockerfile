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
RUN echo "OK" > /tmp/status
ENTRYPOINT tor & /etc/tor/renew-tor.sh

EXPOSE 9050/tcp

HEALTHCHECK --interval=30s --timeout=1s --start-period=5s \
    CMD test "$(cat /tmp/status)" = "OK"
