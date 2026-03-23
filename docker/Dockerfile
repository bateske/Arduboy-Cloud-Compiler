# syntax=docker/dockerfile:1
FROM node:20-slim

# ── System dependencies ─────────────────────────────────────────────────────
# libstdc++6 is required by the avr-gcc toolchain that arduino-cli downloads.
# The toolchain binaries are pre-built Linux x86_64 ELFs that dynamically link
# libstdc++.so.6 — without this the container starts fine but the first compile
# crashes at runtime with "cannot open shared object file".
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget \
      ca-certificates \
      libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# ── Install arduino-cli (pinned version) ────────────────────────────────────
ARG ARDUINO_CLI_VERSION=1.1.1
RUN wget -q -O /tmp/arduino-cli.tar.gz \
      "https://github.com/arduino/arduino-cli/releases/download/v${ARDUINO_CLI_VERSION}/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" \
    && tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli \
    && rm /tmp/arduino-cli.tar.gz \
    && arduino-cli version

# ── Set data directory before core install ──────────────────────────────────
# Explicit path ensures both build-time core install and runtime spawns agree.
ENV ARDUINO_DATA_DIR=/root/.arduino15

# ── Pre-install AVR core (no runtime network dependency) ────────────────────
RUN arduino-cli config init \
    && arduino-cli core update-index \
    && arduino-cli core install arduino:avr

# ── Install Arduboy homemade board package ──────────────────────────────────
# Adds support for all Arduboy variants (FX, FX-C, Mini, DevKit, Homemade,
# Microcade).  The package has empty toolsDependencies so it reuses the
# avr-gcc toolchain already installed by arduino:avr above.
RUN arduino-cli config set board_manager.additional_urls \
      "https://raw.githubusercontent.com/MrBlinky/Arduboy-homemade-package/master/package_arduboy_homemade_index.json" \
    && arduino-cli core update-index \
    && arduino-cli core install arduboy-homemade:avr

# ── Node application ────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/
COPY web/    ./web/
COPY CloudOverlay/ ./CloudOverlay/

# Copy Webtools source (no build step needed — served as-is)
COPY webtools/ ./webtools/

# Pre-create temp build directory
RUN mkdir -p /tmp/arduboy-builds

EXPOSE 8080

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    TMP_BASE=/tmp/arduboy-builds \
    ARDUINO_CLI=arduino-cli \
    ARDUINO_DATA_DIR=/root/.arduino15 \
    WEBTOOLS_DIST=/app/webtools

CMD ["node", "server/index.js"]
