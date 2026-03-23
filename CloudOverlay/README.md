# Sentient Cloud Overlay

A full-screen WebGL particle cloud animation overlay powered by [Three.js](https://threejs.org/). Use it as a loading screen, build indicator, or ambient background effect in any web application.

![Three.js](https://img.shields.io/badge/Three.js-r150+-black?logo=three.js)
![ES Module](https://img.shields.io/badge/format-ES%20Module-blue)

## Quick start

### 1. Provide Three.js

The library imports `three` as a bare module specifier. Supply it however your project prefers:

**Import map (no bundler)**

```html
<script type="importmap">
  { "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
</script>
```

**Bundler (Vite, Webpack, etc.)**

```bash
npm install three
```

### 2. Import and use

```html
<script type="module">
  import { SentientCloudOverlay } from './sentient-cloud.js';

  const cloud = new SentientCloudOverlay();

  // Show the overlay
  cloud.start();

  // Later – dissolve (success)
  await cloud.stop();

  // Or – flash red then dissolve (failure)
  await cloud.fail();
</script>
```

That's it. The library creates its own `<div>` + `<canvas>`, positions them as a fixed overlay at `z-index: 9999`, and cleans up when the animation ends. No extra HTML or CSS is required from the consuming page.

## API

### `new SentientCloudOverlay(options?)`

Creates and initialises the overlay (appended to `document.body`). Nothing is visible until `start()` is called.

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `zIndex` | `number` | `9999` | CSS z-index of the overlay container |
| `gridWidth` | `number` | `150` | Number of points along the X axis |
| `gridLength` | `number` | `150` | Number of points along the Z axis |
| `gridSpacing` | `number` | `5` | World-space distance between points |
| `travelSpeed` | `number` | `30.0` | Speed of the forward camera travel effect |
| `introDuration` | `number` | `3.5` | Seconds for the intro wash-in animation |
| `failDuration` | `number` | `0.5` | Seconds for red flash transition |
| `dissolveDuration` | `number` | `1.5` | Seconds for the dissolve-out animation |
| `fogColor` | `number` | `0x03040a` | Hex colour for the exponential fog |
| `fogDensity` | `number` | `0.0035` | Fog density |
| `colorBase` | `number` | `0x0a3c75` | Base colour of the cloud (low altitudes) |
| `colorHighlight` | `number` | `0x00f2fe` | Highlight colour (high altitudes) |
| `colorRipple` | `number` | `0xffffff` | Colour of the ripple/pulse effect |
| `colorFail` | `number` | `0xff1a1a` | Colour used during the failure state |

### `cloud.start()`

Begins the animation. The overlay fades in and the cloud terrain washes forward. If already running, this is a no-op.

### `cloud.stop() → Promise<void>`

Triggers the dissolve-out animation (success path). Resolves once the overlay is fully hidden and the render loop has stopped.

### `cloud.fail() → Promise<void>`

Transitions the cloud to the failure colour, then dissolves. Resolves once fully hidden.

### `cloud.destroy()`

Removes all DOM elements, disposes of WebGL resources, and detaches the resize listener. The instance cannot be reused after this.

### Properties

| Property | Type | Description |
|---|---|---|
| `cloud.isRunning` | `boolean` | `true` while the animation loop is active |

## Integration examples

### Loading overlay

```js
const cloud = new SentientCloudOverlay();

async function loadApp() {
  cloud.start();
  try {
    await fetchAllData();
    await cloud.stop();
  } catch (err) {
    await cloud.fail();
  }
}
```

### Build status indicator

```js
const cloud = new SentientCloudOverlay({
  introDuration: 2,
  dissolveDuration: 1,
});

cloud.start();
const result = await runBuild();
result.ok ? await cloud.stop() : await cloud.fail();
```

### Custom colours

```js
const cloud = new SentientCloudOverlay({
  colorBase: 0x1a0033,
  colorHighlight: 0xcc44ff,
  colorRipple: 0xffffff,
  colorFail: 0xff0000,
  fogColor: 0x0a001a,
});
```

## File structure

```
sentient-cloud.js   ← the library (single ES module, no dependencies beyond Three.js)
index.html          ← demo page showing basic usage
README.md           ← this file
```

## Requirements

- A browser with WebGL support
- **Three.js r150+** available as the bare specifier `"three"` (via importmap, bundler, or equivalent)

## License

MIT
