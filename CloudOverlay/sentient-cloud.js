/**
 * Sentient Cloud Overlay
 * A full-screen WebGL particle cloud animation overlay powered by Three.js.
 *
 * Usage:
 *   import { SentientCloudOverlay } from './sentient-cloud.js';
 *   const cloud = new SentientCloudOverlay();
 *   cloud.start();              // show the animation
 *   cloud.stop();               // dissolve and hide
 *   cloud.succeed();            // flash green then dissolve (success)
 *   cloud.fail();               // flash red then dissolve (failure)
 *   cloud.destroy();            // clean up all resources
 *
 * Requires Three.js (r150+). Provide it via importmap, bundler, or CDN.
 */

import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
    uniform float uTime;
    uniform float uTravelSpeed;
    uniform float uIntro;
    uniform float uDissolve;
    uniform float uFailure;
    uniform float uSuccess;
    uniform float uSeed;

    attribute float aSize;
    attribute float aOffset;

    varying vec3 vColor;
    varying float vAlpha;

    uniform vec3 uColorBase;
    uniform vec3 uColorHighlight;
    uniform vec3 uColorRipple;
    uniform vec3 uColorFail;
    uniform vec3 uColorSuccess;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    void main() {
        vec3 pos = position;

        float zOffset = uTime * uTravelSpeed;
        float cycleDepth = 750.0;
        pos.z = mod(pos.z + zOffset, cycleDepth) - (cycleDepth * 0.5);

        float baseHeight = snoise(vec2(pos.x * 0.008 + uSeed, pos.z * 0.008 + uTime * 0.05 + uSeed)) * 20.0;

        float distFromCenter = length(pos.xz);
        float sentientPulse = sin(distFromCenter * 0.04 - uTime * 1.0) * 8.0;
        sentientPulse *= smoothstep(250.0, 0.0, distFromCenter);
        pos.y += baseHeight + sentientPulse;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

        gl_PointSize = aSize * (280.0 / -mvPosition.z);

        float twinkle = (sin(uTime * 3.0 + aOffset) + 1.0) * 0.5;
        gl_PointSize *= (0.5 + 0.5 * twinkle);

        gl_Position = projectionMatrix * mvPosition;

        float normalizedHeight = (pos.y + 15.0) / 30.0;
        vec3 landscapeColor = mix(uColorBase, uColorHighlight, clamp(normalizedHeight, 0.0, 1.0));

        float rippleIntensity = max(0.0, sentientPulse) / 5.0;
        vColor = mix(landscapeColor, uColorRipple, rippleIntensity);

        float proximity = 1.0 - smoothstep(30.0, 150.0, -mvPosition.z);
        vColor = mix(vColor, uColorFail, uFailure * proximity);
        vColor = mix(vColor, uColorSuccess, uSuccess * proximity);

        float distAlpha = 1.0 - smoothstep(cycleDepth * 0.4, cycleDepth * 0.5, abs(pos.z));
        float sideAlpha = 1.0 - smoothstep(200.0, 350.0, abs(pos.x));
        vAlpha = distAlpha * sideAlpha * (0.15 + 0.45 * twinkle);

        float washZ = mix(-500.0, 200.0, uIntro);
        vAlpha *= 1.0 - smoothstep(washZ - 200.0, washZ, pos.z);

        float randomThreshold = fract(aOffset * 123.45);
        if (randomThreshold < uDissolve) {
            vAlpha = 0.0;
        }
        vAlpha *= (1.0 - uDissolve);
    }
`;

const FRAGMENT_SHADER = /* glsl */ `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        gl_FragColor = vec4(vColor, vAlpha);
    }
`;

/** Default configuration values. */
const DEFAULTS = {
    zIndex: 9999,
    gridWidth: 150,
    gridLength: 150,
    gridSpacing: 5,
    travelSpeed: 30.0,
    introDuration: 3.5,
    failDuration: 0.3,
    successDuration: 0.3,
    dissolveDuration: 1,
    fogColor: 0x03040a,
    fogDensity: 0.0035,
    colorBase: 0x58d6ff,
    colorHighlight: 0x1a1a2e,
    colorRipple: 0xffffff,
    colorFail: 0xff6b6b,
    colorSuccess: 0x3ddc84,
};

/**
 * Full-screen WebGL cloud animation overlay.
 *
 * @param {object} [options] - Configuration overrides (see DEFAULTS).
 */
export class SentientCloudOverlay {
    constructor(options = {}) {
        this.opts = { ...DEFAULTS, ...options };
        this.isRunning = false;
        this.isStopping = false;
        this.isFailing = false;
        this.isSucceeding = false;
        this._destroyed = false;
        this._onStopCallbacks = [];

        this._injectDOM();
        this._initGL();
    }

    /* ------------------------------------------------------------------ */
    /*  DOM helpers                                                        */
    /* ------------------------------------------------------------------ */

    _injectDOM() {
        // Container
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            z-index: ${this.opts.zIndex};
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.5s ease-in-out;
        `;

        // Canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
        this.container.appendChild(this.canvas);
        document.body.appendChild(this.container);
    }

    /* ------------------------------------------------------------------ */
    /*  Three.js setup                                                     */
    /* ------------------------------------------------------------------ */

    _initGL() {
        const o = this.opts;

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(o.fogColor, o.fogDensity);

        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 10);

        // Point grid
        const totalPoints = o.gridWidth * o.gridLength;
        const positions = new Float32Array(totalPoints * 3);
        const sizes = new Float32Array(totalPoints);
        const offsets = new Float32Array(totalPoints);

        let i = 0;
        let idx = 0;
        for (let ix = 0; ix < o.gridWidth; ix++) {
            for (let iz = 0; iz < o.gridLength; iz++) {
                positions[i++] = (ix - o.gridWidth / 2) * o.gridSpacing;
                positions[i++] = 0;
                positions[i++] = (iz - o.gridLength / 2) * o.gridSpacing;
                sizes[idx] = Math.random() * 2.0 + 1.0;
                offsets[idx] = Math.random() * Math.PI * 2;
                idx++;
            }
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        this.geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColorBase: { value: new THREE.Color(o.colorBase) },
                uColorHighlight: { value: new THREE.Color(o.colorHighlight) },
                uColorRipple: { value: new THREE.Color(o.colorRipple) },
                uColorFail: { value: new THREE.Color(o.colorFail) },
                uColorSuccess: { value: new THREE.Color(o.colorSuccess) },
                uTravelSpeed: { value: o.travelSpeed },
                uIntro: { value: 0.0 },
                uDissolve: { value: 0.0 },
                uFailure: { value: 0.0 },
                uSuccess: { value: 0.0 },
                uSeed: { value: 0.0 },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        this.scene.add(new THREE.Points(this.geometry, this.material));

        this._onResize = () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', this._onResize);

        this.clock = new THREE.Clock(false);
    }

    /* ------------------------------------------------------------------ */
    /*  Public API                                                         */
    /* ------------------------------------------------------------------ */

    /**
     * Show the overlay and begin the animation.
     * If already running, this is a no-op.
     */
    start() {
        if (this._destroyed || this.isRunning) return;
        this.isRunning = true;
        this.isStopping = false;
        this.isFailing = false;
        this.isSucceeding = false;

        // Reset uniforms
        const u = this.material.uniforms;
        u.uIntro.value = 0.0;
        u.uDissolve.value = 0.0;
        u.uFailure.value = 0.0;
        u.uSuccess.value = 0.0;
        u.uSeed.value = Math.random() * 100.0;

        this.clock.start();
        this.startTime = this.clock.getElapsedTime();

        this.container.style.opacity = '1';

        this._animate();
    }

    /**
     * Gracefully dissolve the overlay (success path).
     * Resolves when the animation has fully faded out.
     * @returns {Promise<void>}
     */
    stop() {
        if (!this.isRunning || this.isStopping) {
            return Promise.resolve();
        }
        this.isStopping = true;
        this.isFailing = false;
        this.stopTime = this.clock.getElapsedTime();
        return new Promise((resolve) => this._onStopCallbacks.push(resolve));
    }

    /**
     * Flash the failure colour then dissolve. Resolves when fully hidden.
     * @returns {Promise<void>}
     */
    fail() {
        if (!this.isRunning) return Promise.resolve();
        this.isFailing = true;
        this.failStartTime = this.clock.getElapsedTime();
        return new Promise((resolve) => this._onStopCallbacks.push(resolve));
    }

    /**
     * Flash the success colour then dissolve. Resolves when fully hidden.
     * @returns {Promise<void>}
     */
    succeed() {
        if (!this.isRunning) return Promise.resolve();
        this.isSucceeding = true;
        this.succeedStartTime = this.clock.getElapsedTime();
        return new Promise((resolve) => this._onStopCallbacks.push(resolve));
    }

    /**
     * Remove all DOM elements, WebGL resources, and event listeners.
     * The instance cannot be reused after this call.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this.isRunning = false;
        cancelAnimationFrame(this.animationId);
        window.removeEventListener('resize', this._onResize);
        this.geometry.dispose();
        this.material.dispose();
        this.renderer.dispose();
        this.container.remove();
    }

    /* ------------------------------------------------------------------ */
    /*  Animation loop (private)                                           */
    /* ------------------------------------------------------------------ */

    _animate() {
        if (!this.isRunning) return;

        this.animationId = requestAnimationFrame(this._animate.bind(this));

        const elapsed = this.clock.getElapsedTime();
        const runTime = elapsed - this.startTime;
        const u = this.material.uniforms;

        u.uTime.value = elapsed;

        // Intro wash-forward
        const introP = Math.min(runTime / this.opts.introDuration, 1.0);
        u.uIntro.value = 1.0 - Math.pow(1.0 - introP, 3.0);

        // Failure colour transition
        if (this.isFailing) {
            const failP = Math.min((elapsed - this.failStartTime) / this.opts.failDuration, 1.0);
            u.uFailure.value = failP;
            if (failP >= 1.0 && !this.isStopping) {
                this.isStopping = true;
                this.stopTime = this.clock.getElapsedTime();
            }
        }

        // Success colour transition
        if (this.isSucceeding) {
            const successP = Math.min((elapsed - this.succeedStartTime) / this.opts.successDuration, 1.0);
            u.uSuccess.value = successP;
            if (successP >= 1.0 && !this.isStopping) {
                this.isStopping = true;
                this.stopTime = this.clock.getElapsedTime();
            }
        }

        // Dissolve out
        if (this.isStopping) {
            const fadeP = Math.min((elapsed - this.stopTime) / this.opts.dissolveDuration, 1.0);
            u.uDissolve.value = fadeP;
            if (fadeP >= 1.0) {
                this.isRunning = false;
                cancelAnimationFrame(this.animationId);
                this.container.style.opacity = '0';
                this.isStopping = false;
                this.isFailing = false;
                this.isSucceeding = false;
                this._onStopCallbacks.forEach((cb) => cb());
                this._onStopCallbacks = [];
                return;
            }
        }

        // Camera motion
        const sway = Math.sin(elapsed * 0.2) * 8.0;
        const breathingY = Math.sin(elapsed * 0.3) * 2.0;
        this.camera.position.x = sway;
        this.camera.position.y = 20 + breathingY;
        this.camera.lookAt(sway * 0.3, -20, -100);

        this.renderer.render(this.scene, this.camera);
    }
}
