# Arduboy Cloud — Architecture Guide

> Target audience: developers and AI coding agents working on this codebase.
> For detailed documentation on each subsystem, see the files in `docs/`.

---

## 1. Project Purpose

A unified web application that combines:

1. **Arduboy Webtools** — Browser-based tools for the Arduboy platform (sketch flashing, FX flash management, EEPROM editing, cart building, package editing, image conversion, music editing, FX data building)
2. **Cloud Compiler IDE** — A Monaco-based code editor with multi-file tabs, Arduboy autocomplete, cloud compilation via arduino-cli, Ardens WASM simulator, bitmap CodeLens, and FX data visual editor

Both applications are served from a single Express server and packaged in a single Docker container. The compiler IDE appears natively (not in an iframe) inside the "Code" tab of the Webtools SPA.

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (Client)                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Webtools SPA (webtools/index.html)                  │   │
│  │  ┌─────┬────┬──────┬───────┬────┬─────┬─────┬─────┐ │   │
│  │  │Welc │Sket│FX    │EEPROM │Cart│Image│Music│FX   │ │   │
│  │  │ome  │ ch │Flash │       │ Pkg│     │     │Data │ │   │
│  │  └─────┴────┴──────┴───────┴────┴─────┴─────┴─────┘ │   │
│  │  ┌─────────────────────────────────────────────────┐ │   │
│  │  │  Code Tab (#panel-code > #compiler-root)        │ │   │
│  │  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐│ │   │
│  │  │  │ Monaco   │ │ Tab Mgr  │ │ Ardens WASM      ││ │   │
│  │  │  │ Editor   │ │ + FX View│ │ Simulator        ││ │   │
│  │  │  │ (CDN)    │ │ + Bitmap │ │ (web/ardens/)    ││ │   │
│  │  │  └────┬─────┘ │ CodeLens │ └────────┬─────────┘│ │   │
│  │  │       └──┬─────┘          │          │          │ │   │
│  │  │          ▼                │          │          │ │   │
│  │  │  ┌──────────────────┐    │          │          │ │   │
│  │  │  │  Build/Poll      │◄───┼──hex─────┘          │ │   │
│  │  │  │  REST Client     │    │                     │ │   │
│  │  │  └────────┬─────────┘    │                     │ │   │
│  │  └───────────┼──────────────┘─────────────────────┘ │   │
│  └──────────────┼──────────────────────────────────────┘   │
└─────────────────┼──────────────────────────────────────────┘
                  │ HTTP (fetch)
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js Express Server (port 8080)             │
│                                                             │
│  Static serving:                                            │
│  ├── /compiler/*      → web/                                │
│  ├── /cloud-overlay/* → CloudOverlay/                       │
│  └── /*               → webtools/                           │
│                                                             │
│  API routes:                                                │
│  ├── POST /build      → validate → jobs queue               │
│  ├── GET  /poll       → job status                          │
│  ├── GET  /build/:id.hex → hex download                     │
│  ├── GET  /libraries  → installed Arduino libraries         │
│  └── GET  /version    → diagnostics                         │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐        │
│  │ index.js │→ │ jobs.js  │→ │ compile.js         │        │
│  │ Routes   │  │ Queue    │  │ arduino-cli spawn   │        │
│  └──────────┘  └──────────┘  └────────────────────┘        │
│  ┌──────────┐  ┌──────────┐                                │
│  │validate  │  │ config   │                                │
│  └──────────┘  └──────────┘                                │
└─────────────────────────────────────────────────────────────┘
                  │ child_process.spawn
                  ▼
┌─────────────────────────────────────────────────────────────┐
│  arduino-cli (binary, v1.1.1 pinned)                        │
│  Cores: arduino:avr, arduboy-homemade:avr                   │
│  Produces: .hex files                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Repository Structure

```
arduboy-cloud-compiler/
├── server/                 Backend (Node.js/Express)
│   ├── index.js            Express app, routes, static serving
│   ├── config.js           Configuration with env overrides
│   ├── jobs.js             In-memory job queue + worker
│   ├── compile.js          arduino-cli invocation
│   ├── validate.js         Input validation
│   └── util.js             Filesystem helpers
│
├── web/                    Compiler frontend (served at /compiler/*)
│   ├── app.js              Main IDE logic (~8,757 lines IIFE)
│   ├── bitmap-detector.js  Bitmap detection + CodeLens (~1,447 lines)
│   ├── arduboy-completions.js  Autocomplete data (~996 lines)
│   ├── style-scoped.css    Scoped CSS (~4,385 lines)
│   ├── sim-popout.html     Simulator popout window
│   └── ardens/             WASM emulator (Ardens.js + Ardens.wasm)
│
├── webtools/               Webtools SPA (served at /*)
│   ├── index.html          Merged HTML: all panels + compiler
│   ├── assets/fonts/       Bitmap font manifests (JSON)
│   └── src/
│       ├── main.js         Entry point (~1,902 lines ES module)
│       ├── core/           Pure logic: formats, fxdata, music, serial, operations
│       └── ui/             UI modules: editors, pixel editor, styles
│
├── CloudOverlay/           Sentient Cloud WebGL animation library
│   ├── sentient-cloud.js   ES module (requires Three.js)
│   ├── index.html          Demo page
│   └── README.md
│
├── docker/
│   ├── Dockerfile          Node 20 + arduino-cli + AVR cores
│   └── .dockerignore
│
├── scripts/
│   └── test_api.sh         API smoke test
│
├── reference/              Third-party reference material (read-only)
│   ├── Ardens/             Ardens emulator C++ source
│   ├── Arduboy-homemade-package/  MrBlinky's board package
│   ├── Arduboy-Python-Utilities/  Python flash tools
│   ├── PixelFonts/         Font manifest sources + handoff doc
│   ├── Example Binaries/   Test hex/bin files
│   └── *.md                Domain knowledge docs
│
├── docs/                   Detailed subsystem documentation
│   ├── server.md           Backend modules + Docker
│   ├── api.md              HTTP API reference
│   ├── compiler-ide.md     Code tab / web/ reference
│   ├── webtools.md         Webtools SPA / webtools/ reference
│   ├── fxdata-pipeline.md  FX data build system
│   ├── pixel-editor.md     Pixel editor system
│   └── integration.md      CSS/JS isolation techniques
│
├── package.json            Single dependency: express
├── README.md               User-facing quickstart
└── OBSERVATIONS.md         Project analysis notes & suggestions
```

---

## 4. How the Two Apps Coexist

The compiler IDE lives inside `#panel-code > #compiler-root` in the merged `webtools/index.html`. CSS isolation via `#compiler-root` scoping. JS isolation via body reference replacement, deferred event patching, and scoped drag-and-drop. Full details in `docs/integration.md`.

---

## 5. Runtime Modes

| Mode | Command | Notes |
|------|---------|-------|
| **Docker** (prod) | `docker build -f docker/Dockerfile -t arduboy-cloud . && docker run --rm -p 8080:8080 arduboy-cloud` | Self-contained |
| **Local dev** | `npm install && npm run dev` | Needs arduino-cli on host for compilation |
| **Windows** | `run-docker.bat` | Stops old container, rebuilds, runs |

---

## 6. Key Design Decisions

- **No build step** — Source served directly with CDN import maps
- **No iframe** — Native integration for future cross-tool workflows
- **Single IIFE** — Compiler IDE in one vanilla JS file (no modules/framework)
- **ES modules** — Webtools uses standard ES module imports
- **Single npm dependency** — Only `express` in package.json
- **In-memory job queue** — No external database or message queue
- **Bridges** — `window.__fxBridge`, `window.__pixelEditor`, `window.BitmapDetector` connect ES modules to IIFE

---

## 7. Documentation Index

| Document | Scope |
|----------|-------|
| [`docs/server.md`](docs/server.md) | Express server, compile pipeline, Docker, config |
| [`docs/api.md`](docs/api.md) | HTTP API endpoints, board targets, global interfaces |
| [`docs/compiler-ide.md`](docs/compiler-ide.md) | Code tab: Monaco, tabs, FX view, build, simulator, bitmap CodeLens |
| [`docs/webtools.md`](docs/webtools.md) | Webtools SPA: all panels, core modules, UI components |
| [`docs/fxdata-pipeline.md`](docs/fxdata-pipeline.md) | FX data: parser, build, encoder, VFS, output files |
| [`docs/pixel-editor.md`](docs/pixel-editor.md) | Pixel editor: tools, image model, integration contexts |
| [`docs/integration.md`](docs/integration.md) | CSS/JS isolation, lazy loading, bridges |
| [`OBSERVATIONS.md`](OBSERVATIONS.md) | Project analysis notes, suggestions, technical debt |

---

## 8. Key Dependencies

| Dependency | Version | Role |
|-----------|---------|------|
| Node.js | >= 20 | Server runtime |
| Express | ^4.18.2 | HTTP framework |
| arduino-cli | 1.1.1 (pinned) | AVR compiler toolchain |
| arduino:avr | 1.8.7 | AVR board core |
| arduboy-homemade:avr | latest | Arduboy variant boards |
| Monaco Editor | 0.45.0 | Code editor (CDN) |
| JSZip | 3.10.1 | ZIP import/export (CDN) |
| @tonejs/midi | 2.0.28 | MIDI parsing (CDN) |
| Three.js | r160+ | Cloud overlay animation (CDN) |
| Ardens | bundled | Arduboy WASM emulator |

---

## 9. Security Model

- Input validation: strict filename regex, path traversal rejection
- Size limits: 512 KB body, 20 files max
- Process isolation: each compile in unique temp dir
- Compile timeout: 60s wall-clock kill
- Job TTL: 10 min cleanup
- No runtime network requests from Docker container
- FQBN regex validation before passing to arduino-cli
