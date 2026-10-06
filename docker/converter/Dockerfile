# Skynet document converter: LibreOffice (headless, no GUI, no Java) behind
# a small HTTP API (server.py). Runs as its own locked-down container on an
# internal-only network; see docker-compose.yml.
#
# Build: docker build -t skynet-converter:local docker/converter
ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      python3 \
      # Metric-compatible stand-ins for the Microsoft fonts (Arial/Times/
      # Courier → Liberation, Calibri → Carlito, Cambria → Caladea) so
      # layouts keep their line breaks, plus broad Unicode coverage.
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
      fonts-dejavu-core fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --home-dir /tmp/home --shell /usr/sbin/nologin converter
COPY server.py /app/server.py

USER converter
ENV HOME=/tmp/home \
    CONVERTER_WORK_ROOT=/tmp/converter \
    PYTHONUNBUFFERED=1
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3030/healthz', timeout=4).status == 200 else 1)"
CMD ["python3", "/app/server.py"]
