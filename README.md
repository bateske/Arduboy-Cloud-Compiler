# Arduboy Cloud

A unified web application combining the **Arduboy Webtools** suite with a **cloud compiler IDE**. Everything served from a single Express server, packaged in a single Docker container.

---

## Quick Start (Docker — recommended)

```bash
docker build -f docker/Dockerfile -t arduboy-cloud .
docker run --rm -p 8080:8080 arduboy-cloud
# Open http://localhost:8080/
```

## Quick Start (local dev)

```bash
npm install
npm run dev
# Open http://localhost:8080/
```

Requires `arduino-cli` + AVR core + arduboy-homemade board package on the host for compilation. Webtools tabs work without arduino-cli.

---

## What You Get

| Tab | Functionality |
|-----|---------------|
| **Welcome** | Landing page with CloudBuddy mascot |
| **Code** | Monaco editor IDE with multi-file tabs, Arduboy autocomplete, bitmap CodeLens editing, FX data visual editor, cloud compilation, Ardens WASM simulator |
| **Sketch** | Flash .hex/.arduboy files to Arduboy via WebSerial |
| **FX Flash** | Read/write external flash memory |
| **EEPROM** | Read/edit 1KB EEPROM game saves |
| **Cart Editor** | Build and manage FX flash cart collections |
| **Package** | Create/edit .arduboy package files |
| **Image** | Convert images to Arduboy sprite format |
| **Music** | MIDI import → ArduboyTones/ArduboyPlaytune export |
| **FX Data** | Visual FX data script editor + build pipeline |

---

## Architecture

```
Express server (port 8080)
├── GET /                → Webtools SPA (index.html)
├── GET /compiler/*      → Compiler frontend (app.js, CSS, Ardens WASM)
├── GET /cloud-overlay/* → Cloud overlay animation library
├── POST /build          → Compile API
├── GET /poll?id=        → Poll compile status
├── GET /build/:id.hex   → Download compiled hex
├── GET /libraries       → Installed Arduino libraries
└── GET /version         → Diagnostics
```

The compiler IDE lives inside the "Code" tab of the Webtools SPA — native integration (no iframe) with CSS isolation via `#compiler-root` scoping. Compiler scripts lazy-load on first Code tab activation. No bundler — source files served directly with CDN import maps.

---

## API

### `POST /build`

```json
{
  "files": { "main.ino": "void setup() {} void loop() {}" },
  "fqbn": "arduboy-homemade:avr:arduboy-fx:core=arduboy-core"
}
```

Response: `{ "ok": true, "id": "<uuid>", "status": "queued" }`

### `GET /poll?id=<uuid>`

Poll every ~3s. Returns `{ status: "building"|"done"|"error", log, hex }`.

### `GET /build/<uuid>.hex`

Download compiled hex file.

### `GET /libraries`

Returns installed Arduino libraries with metadata.

### `GET /version`

Returns arduino-cli version and installed cores.

---

## Documentation

| Document | Contents |
|----------|----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | High-level architecture, repository structure, design decisions |
| [`docs/server.md`](docs/server.md) | Backend modules, Docker, configuration |
| [`docs/api.md`](docs/api.md) | HTTP API reference, board targets, global interfaces |
| [`docs/compiler-ide.md`](docs/compiler-ide.md) | Code tab: Monaco, tabs, FX view, build, simulator, CodeLens |
| [`docs/webtools.md`](docs/webtools.md) | Webtools SPA: panels, core modules, UI components |
| [`docs/fxdata-pipeline.md`](docs/fxdata-pipeline.md) | FX data: parser, build, encoder, VFS |
| [`docs/pixel-editor.md`](docs/pixel-editor.md) | Pixel editor: tools, image model, integration |
| [`docs/integration.md`](docs/integration.md) | CSS/JS isolation, lazy loading, bridges |
| [`OBSERVATIONS.md`](OBSERVATIONS.md) | Project analysis notes and suggestions |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | TCP port |
| `HOST` | `0.0.0.0` | Bind address |
| `TMP_BASE` | `<os.tmpdir()>/arduboy-builds` | Build temp directory |
| `ARDUINO_CLI` | `arduino-cli` | Path to arduino-cli binary |
| `ARDUINO_DATA_DIR` | `~/.arduino15` | Arduino config/cores |
| `WEBTOOLS_DIST` | `../webtools` (relative) | Webtools source directory |

---

## Safety Constraints

- Max request body: 512 KB
- Max files per request: 20
- Filenames: `[a-zA-Z0-9_.\-/]` only — no path traversal
- Exactly one `.ino` file required
- Compile timeout: 60 seconds
- Job TTL: 10 minutes
- No runtime network requests from container

---

## Repository Structure

```
├── server/          Backend (Express API + compilation)
├── web/             Compiler frontend (IDE, simulator, CSS)
├── webtools/        Webtools SPA (tools, core logic, UI)
├── CloudOverlay/    Cloud animation overlay (Three.js)
├── docker/          Dockerfile + .dockerignore
├── scripts/         API smoke test
├── reference/       Third-party reference material (not runtime)
├── docs/            Detailed subsystem documentation
└── *.md             Root documentation files
```
