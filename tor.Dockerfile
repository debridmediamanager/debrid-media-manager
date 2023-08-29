FROM alpine:latest

RUN apk --no-cache --update --upgrade add tor curl grep netcat-openbsd \
    && mv /etc/tor/torrc.sample  /etc/tor/torrc \
    && sed -i \
        -e 's/#SOCKSPort 192.168.0.1:9100/SOCKSPort 0.0.0.0:9050/g' \
        /etc/tor/torrc \
    && chown -R tor /var/lib/tor \
    && echo "#!/bin/sh" > /usr/local/bin/check-and-renew.sh \
    && echo "while true; do" >> /usr/local/bin/check-and-renew.sh \
    && echo "  curl -x socks5h://127.0.0.1:9050 -s http://btdigggink2pdqzqrik3blmqemsbntpzwxottujilcdjfz56jumzfsyd.onion/search?q=Kraftfahrzeughaftpflichtversicherung | grep -qm1 Histats || (echo -e 'AUTHENTICATE \"\"\\nsignal NEWNYM\\nQUIT' | nc 127.0.0.1 9051 && echo 'IP has been renewed')" >> /usr/local/bin/check-and-renew.sh \
    && echo "  sleep 30" >> /usr/local/bin/check-and-renew.sh \
    && echo "done" >> /usr/local/bin/check-and-renew.sh \
    && chmod +x /usr/local/bin/check-and-renew.sh

USER tor
ENTRYPOINT tor & /usr/local/bin/check-and-renew.sh

EXPOSE 9050/tcp

HEALTHCHECK --interval=60s --timeout=15s --start-period=20s \
    CMD curl -s --socks5 127.0.0.1:9050 'https://check.torproject.org/api/ip' | grep -qm1 -E '"IsTor"\s*:\s*true'
