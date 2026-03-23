/**
 * Web Serial transport layer.
 *
 * Wraps the Web Serial API with buffered reading, error handling,
 * and a clean async interface.
 *
 * Key difference from pyserial: Web Serial's reader.read() returns
 * variable-size chunks, NOT exact byte counts. This class implements
 * buffering to provide exact-length reads.
 *
 * Ported from: ArduboyWebFlasher SerialPortManager + pyserial patterns
 */

import { sleep } from '../utils/binary.js';

export class SerialTransport {
  /** @type {SerialPort|null} */
  #port = null;

  /** @type {WritableStreamDefaultWriter|null} */
  #writer = null;

  /** @type {ReadableStreamDefaultReader|null} */
  #reader = null;

  /** @type {Uint8Array} Internal read buffer for accumulating partial reads */
  #buffer = new Uint8Array(0);

  /** @type {boolean} Whether the port is currently open */
  #isOpen = false;

  /** @type {((reason?: string) => void)|null} Callback fired on unexpected disconnect */
  #onDisconnect = null;

  /** @type {boolean} True while a protocol read is in progress */
  #reading = false;

  /** @type {AbortController|null} Controls the sentinel read loop */
  #sentinelAbort = null;

  /** Bound handler so we can remove the navigator.serial disconnect listener */
  #boundDisconnectHandler = null;

  /**
   * Register a callback that fires when the device disconnects unexpectedly.
   * @param {((reason?: string) => void)|null} cb
   */
  set onDisconnect(cb) {
    this.#onDisconnect = cb;
  }

  /**
   * Check if Web Serial API is available.
   * @returns {boolean}
   */
  static isSupported() {
    return 'serial' in navigator;
  }

  /**
   * Set an already-obtained serial port (from navigator.serial.requestPort).
   * @param {SerialPort} port
   */
  setPort(port) {
    this.#port = port;
  }

  /**
   * Request a serial port from the user via browser picker.
   * Must be called from a user gesture (click, etc.).
   *
   * @param {Array<{usbVendorId: number, usbProductId: number}>} filters - USB device filters
   * @returns {Promise<void>}
   * @throws {Error} If user cancels or no matching device
   */
  async requestPort(filters) {
    if (!SerialTransport.isSupported()) {
      throw new Error('Web Serial API is not supported. Use Chrome or Edge.');
    }
    this.#port = await navigator.serial.requestPort({ filters });
  }

  /**
   * Open the serial port.
   *
   * @param {number} baudRate - Baud rate (115200 for programming, 1200 for reset trick)
   * @param {number} [bufferSize=65536] - Read buffer size (64KB needed for FX block writes)
   * @returns {Promise<void>}
   */
  async open(baudRate, bufferSize = 65536) {
    if (!this.#port) throw new Error('No port selected. Call requestPort() first.');
    if (this.#isOpen) throw new Error('Port is already open.');

    await this.#port.open({ baudRate, bufferSize });
    this.#writer = this.#port.writable.getWriter();
    this.#reader = this.#port.readable.getReader();
    this.#buffer = new Uint8Array(0);
    this.#isOpen = true;

    // Listen for physical USB disconnect via the Web Serial API
    this.#boundDisconnectHandler = (event) => {
      if (event.target === this.#port) {
        this.#handleUnexpectedDisconnect('USB device removed');
      }
    };
    navigator.serial.addEventListener('disconnect', this.#boundDisconnectHandler);

    // Start a sentinel that detects port loss when we're not actively reading
    this.#startSentinel();
  }

  /**
   * Close the serial port and release all resources.
   * Safe to call multiple times.
   * @returns {Promise<void>}
   */
  async close() {
    // Stop the sentinel read loop
    this.#stopSentinel();

    // Remove the navigator.serial disconnect listener
    if (this.#boundDisconnectHandler) {
      navigator.serial.removeEventListener('disconnect', this.#boundDisconnectHandler);
      this.#boundDisconnectHandler = null;
    }

    try {
      if (this.#reader) {
        await this.#reader.cancel().catch(() => {});
        this.#reader.releaseLock();
        this.#reader = null;
      }
    } catch { /* ignore */ }

    try {
      if (this.#writer) {
        await this.#writer.close().catch(() => {});
        this.#writer.releaseLock();
        this.#writer = null;
      }
    } catch { /* ignore */ }

    try {
      if (this.#port && this.#isOpen) {
        await this.#port.close();
      }
    } catch { /* ignore */ }

    this.#isOpen = false;
    this.#buffer = new Uint8Array(0);
  }

  /**
   * Write data to the serial port.
   * @param {Uint8Array} data - Data to write
   * @returns {Promise<void>}
   */
  async write(data) {
    if (!this.#writer) throw new Error('Port not open for writing.');
    try {
      await this.#writer.write(data);
    } catch (err) {
      if (this.#isOpen) {
        this.#handleUnexpectedDisconnect(`Write failed: ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Read an exact number of bytes from the serial port.
   * Buffers internally until the requested amount is available.
   *
   * @param {number} length - Exact number of bytes to read
   * @param {number} [timeout=5000] - Timeout in milliseconds (0 = no timeout)
   * @returns {Promise<Uint8Array>} Exactly `length` bytes
   * @throws {Error} On timeout or read failure
   */
  async read(length, timeout = 5000) {
    if (!this.#reader) throw new Error('Port not open for reading.');

    this.#reading = true;
    try {
      const startTime = Date.now();

      while (this.#buffer.length < length) {
        if (timeout > 0 && Date.now() - startTime > timeout) {
          throw new Error(`Serial read timeout: expected ${length} bytes, got ${this.#buffer.length}`);
        }

        const { value, done } = await this.#reader.read();
        if (done) {
          throw new Error('Serial port closed during read.');
        }
        if (value && value.length > 0) {
          // Accumulate into buffer
          const newBuffer = new Uint8Array(this.#buffer.length + value.length);
          newBuffer.set(this.#buffer, 0);
          newBuffer.set(value, this.#buffer.length);
          this.#buffer = newBuffer;
        }
      }

      // Extract exactly `length` bytes, keep remainder in buffer
      const result = this.#buffer.slice(0, length);
      this.#buffer = this.#buffer.slice(length);
      return result;
    } catch (err) {
      // If the read fails due to disconnect, fire the callback
      if (this.#isOpen) {
        this.#handleUnexpectedDisconnect(`Read failed: ${err.message}`);
      }
      throw err;
    } finally {
      this.#reading = false;
    }
  }

  /**
   * Write data and then read a response.
   * Convenience method for command-response patterns.
   *
   * @param {Uint8Array} data - Data to write
   * @param {number} [responseLength=1] - Expected response length
   * @param {number} [timeout=5000] - Read timeout
   * @returns {Promise<Uint8Array>} Response bytes
   */
  async writeAndRead(data, responseLength = 1, timeout = 5000) {
    await this.write(data);
    return this.read(responseLength, timeout);
  }

  /**
   * Whether the port is currently open and usable.
   * @returns {boolean}
   */
  get isOpen() {
    return this.#isOpen;
  }

  /**
   * Get the underlying SerialPort info.
   * @returns {{usbVendorId?: number, usbProductId?: number}|null}
   */
  getPortInfo() {
    return this.#port ? this.#port.getInfo() : null;
  }

  // -----------------------------------------------------------------------
  // Disconnect detection internals
  // -----------------------------------------------------------------------

  /**
   * Handle an unexpected disconnect (USB removal, stream error, etc.).
   * Cleans up resources and fires the onDisconnect callback exactly once.
   * @param {string} reason - Human-readable reason for the disconnect
   */
  #handleUnexpectedDisconnect(reason) {
    if (!this.#isOpen) return; // already handled

    const cb = this.#onDisconnect;
    // Tear down without firing the callback again
    this.close().catch(() => {});
    cb?.(reason);
  }

  /**
   * Start a background sentinel that detects port loss while idle.
   *
   * Uses a polling loop that checks whether the port's readable stream
   * has errored. This catches cases where the OS closes the COM port
   * (driver crash, sleep/wake, etc.) without a USB disconnect event.
   *
   * We intentionally do NOT start a competing reader.read() because
   * only one consumer can hold the reader lock at a time. Instead we
   * poll the port's readable/writable stream states.
   */
  #startSentinel() {
    this.#sentinelAbort = new AbortController();
    const signal = this.#sentinelAbort.signal;

    const check = () => {
      if (signal.aborted || !this.#isOpen) return;

      // If the port's streams have been torn down by the browser, we're gone
      try {
        if (this.#port && (!this.#port.readable || !this.#port.writable)) {
          this.#handleUnexpectedDisconnect('Port streams closed');
          return;
        }
      } catch {
        this.#handleUnexpectedDisconnect('Port access error');
        return;
      }

      setTimeout(check, 20);
    };

    setTimeout(check, 20);
  }

  /** Stop the sentinel polling loop. */
  #stopSentinel() {
    if (this.#sentinelAbort) {
      this.#sentinelAbort.abort();
      this.#sentinelAbort = null;
    }
  }

  /**
   * Perform the 1200-baud reset trick to enter bootloader mode.
   * Opens the port at 1200 baud, waits briefly, then closes it.
   * The ATmega32U4 CDC driver detects this and resets into the bootloader.
   *
   * After calling this, the device will re-enumerate with a different USB PID.
   * You'll need to call requestPort() + open() again for the new device.
   *
   * @returns {Promise<void>}
   */
  async triggerBootloaderReset() {
    if (!this.#port) throw new Error('No port selected.');

    // Close existing connection if open
    if (this.#isOpen) {
      await this.close();
    }

    // Open at 1200 baud and immediately close — this triggers the reset
    await this.#port.open({ baudRate: 1200 });
    await sleep(20);
    await this.#port.close();
    await sleep(20);
  }
}
