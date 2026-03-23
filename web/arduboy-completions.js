/* Arduboy Cloud Compiler — Arduino & Arduboy2 autocomplete definitions */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   *  Arduino Core Functions
   * ══════════════════════════════════════════════════════════════════════ */
  var ARDUINO_FUNCTIONS = [
    {
      label: 'setup',
      kind: 'Function',
      insertText: 'void setup() {\n\t$0\n}',
      isSnippet: true,
      detail: 'void setup()',
      documentation: 'Called once when the sketch starts. Use it to initialize variables, pin modes, start using libraries, etc.',
      signature: 'void setup()'
    },
    {
      label: 'loop',
      kind: 'Function',
      insertText: 'void loop() {\n\t$0\n}',
      isSnippet: true,
      detail: 'void loop()',
      documentation: 'Called repeatedly after `setup()`. Use it to actively control the Arduboy.',
      signature: 'void loop()'
    },
    {
      label: 'pinMode',
      kind: 'Function',
      insertText: 'pinMode(${1:pin}, ${2|INPUT,OUTPUT,INPUT_PULLUP|})',
      isSnippet: true,
      detail: 'void pinMode(uint8_t pin, uint8_t mode)',
      documentation: 'Configures the specified pin to behave either as an input or an output.\n\n**Parameters:**\n- `pin` — the Arduino pin number\n- `mode` — `INPUT`, `OUTPUT`, or `INPUT_PULLUP`',
      signature: 'void pinMode(uint8_t pin, uint8_t mode)'
    },
    {
      label: 'digitalWrite',
      kind: 'Function',
      insertText: 'digitalWrite(${1:pin}, ${2|HIGH,LOW|})',
      isSnippet: true,
      detail: 'void digitalWrite(uint8_t pin, uint8_t val)',
      documentation: 'Write a HIGH or LOW value to a digital pin.\n\n**Parameters:**\n- `pin` — the Arduino pin number\n- `val` — `HIGH` or `LOW`',
      signature: 'void digitalWrite(uint8_t pin, uint8_t val)'
    },
    {
      label: 'digitalRead',
      kind: 'Function',
      insertText: 'digitalRead(${1:pin})',
      isSnippet: true,
      detail: 'int digitalRead(uint8_t pin)',
      documentation: 'Reads the value from a specified digital pin, either `HIGH` or `LOW`.\n\n**Returns:** `HIGH` or `LOW`',
      signature: 'int digitalRead(uint8_t pin)'
    },
    {
      label: 'analogWrite',
      kind: 'Function',
      insertText: 'analogWrite(${1:pin}, ${2:value})',
      isSnippet: true,
      detail: 'void analogWrite(uint8_t pin, int val)',
      documentation: 'Writes an analog value (PWM wave) to a pin. Values range from 0 (always off) to 255 (always on).\n\n**Parameters:**\n- `pin` — the PWM-capable pin\n- `val` — 0–255',
      signature: 'void analogWrite(uint8_t pin, int val)'
    },
    {
      label: 'analogRead',
      kind: 'Function',
      insertText: 'analogRead(${1:pin})',
      isSnippet: true,
      detail: 'int analogRead(uint8_t pin)',
      documentation: 'Reads the value from the specified analog pin.\n\n**Returns:** 0–1023',
      signature: 'int analogRead(uint8_t pin)'
    },
    {
      label: 'delay',
      kind: 'Function',
      insertText: 'delay(${1:ms})',
      isSnippet: true,
      detail: 'void delay(unsigned long ms)',
      documentation: 'Pauses the program for the amount of time (in milliseconds) specified.\n\n**Note:** Avoid using `delay()` in Arduboy games — use `nextFrame()` timing instead.',
      signature: 'void delay(unsigned long ms)'
    },
    {
      label: 'delayMicroseconds',
      kind: 'Function',
      insertText: 'delayMicroseconds(${1:us})',
      isSnippet: true,
      detail: 'void delayMicroseconds(unsigned int us)',
      documentation: 'Pauses the program for the amount of time (in microseconds) specified.',
      signature: 'void delayMicroseconds(unsigned int us)'
    },
    {
      label: 'millis',
      kind: 'Function',
      insertText: 'millis()',
      isSnippet: false,
      detail: 'unsigned long millis()',
      documentation: 'Returns the number of milliseconds passed since the program started. Wraps after approximately 50 days.',
      signature: 'unsigned long millis()'
    },
    {
      label: 'micros',
      kind: 'Function',
      insertText: 'micros()',
      isSnippet: false,
      detail: 'unsigned long micros()',
      documentation: 'Returns the number of microseconds since the program started. Wraps after approximately 70 minutes.',
      signature: 'unsigned long micros()'
    },
    {
      label: 'random',
      kind: 'Function',
      insertText: 'random(${1:max})',
      isSnippet: true,
      detail: 'long random(long max) / long random(long min, long max)',
      documentation: 'Generates a pseudo-random number.\n\n- `random(max)` — returns 0 to max-1\n- `random(min, max)` — returns min to max-1',
      signature: 'long random(long max)'
    },
    {
      label: 'randomSeed',
      kind: 'Function',
      insertText: 'randomSeed(${1:seed})',
      isSnippet: true,
      detail: 'void randomSeed(unsigned long seed)',
      documentation: 'Initializes the pseudo-random number generator with a seed value.',
      signature: 'void randomSeed(unsigned long seed)'
    },
    {
      label: 'map',
      kind: 'Function',
      insertText: 'map(${1:value}, ${2:fromLow}, ${3:fromHigh}, ${4:toLow}, ${5:toHigh})',
      isSnippet: true,
      detail: 'long map(long value, long fromLow, long fromHigh, long toLow, long toHigh)',
      documentation: 'Re-maps a number from one range to another.\n\n**Example:** `map(analogRead(0), 0, 1023, 0, 255)`',
      signature: 'long map(long value, long fromLow, long fromHigh, long toLow, long toHigh)'
    },
    {
      label: 'constrain',
      kind: 'Function',
      insertText: 'constrain(${1:x}, ${2:a}, ${3:b})',
      isSnippet: true,
      detail: 'constrain(x, a, b)',
      documentation: 'Constrains a number to be within a range.\n\n**Returns:** `a` if `x < a`, `b` if `x > b`, otherwise `x`.',
      signature: 'constrain(x, a, b)'
    },
    {
      label: 'min',
      kind: 'Function',
      insertText: 'min(${1:a}, ${2:b})',
      isSnippet: true,
      detail: 'min(a, b)',
      documentation: 'Returns the smaller of two values.',
      signature: 'min(a, b)'
    },
    {
      label: 'max',
      kind: 'Function',
      insertText: 'max(${1:a}, ${2:b})',
      isSnippet: true,
      detail: 'max(a, b)',
      documentation: 'Returns the larger of two values.',
      signature: 'max(a, b)'
    },
    {
      label: 'abs',
      kind: 'Function',
      insertText: 'abs(${1:x})',
      isSnippet: true,
      detail: 'abs(x)',
      documentation: 'Returns the absolute value of a number.',
      signature: 'abs(x)'
    },
    {
      label: 'sq',
      kind: 'Function',
      insertText: 'sq(${1:x})',
      isSnippet: true,
      detail: 'sq(x)',
      documentation: 'Returns the square of a number: `x * x`.',
      signature: 'sq(x)'
    },
    {
      label: 'sqrt',
      kind: 'Function',
      insertText: 'sqrt(${1:x})',
      isSnippet: true,
      detail: 'double sqrt(double x)',
      documentation: 'Returns the square root of a number.',
      signature: 'double sqrt(double x)'
    },
    {
      label: 'pow',
      kind: 'Function',
      insertText: 'pow(${1:base}, ${2:exponent})',
      isSnippet: true,
      detail: 'double pow(double base, double exponent)',
      documentation: 'Returns base raised to the power of exponent.',
      signature: 'double pow(double base, double exponent)'
    },
    {
      label: 'sin',
      kind: 'Function',
      insertText: 'sin(${1:rad})',
      isSnippet: true,
      detail: 'double sin(double rad)',
      documentation: 'Returns the sine of an angle (in radians).',
      signature: 'double sin(double rad)'
    },
    {
      label: 'cos',
      kind: 'Function',
      insertText: 'cos(${1:rad})',
      isSnippet: true,
      detail: 'double cos(double rad)',
      documentation: 'Returns the cosine of an angle (in radians).',
      signature: 'double cos(double rad)'
    },
    {
      label: 'tan',
      kind: 'Function',
      insertText: 'tan(${1:rad})',
      isSnippet: true,
      detail: 'double tan(double rad)',
      documentation: 'Returns the tangent of an angle (in radians).',
      signature: 'double tan(double rad)'
    },
    /* ── PROGMEM / Flash helpers ─────────────────────────────────────── */
    {
      label: 'F',
      kind: 'Function',
      insertText: 'F(${1:"string"})',
      isSnippet: true,
      detail: 'F("string")',
      documentation: 'Store a string literal in flash (PROGMEM) to save SRAM. Use with `print()` and `println()`.\n\n**Example:** `arduboy.print(F("Hello"));`',
      signature: 'F("string")'
    },
    {
      label: 'pgm_read_byte',
      kind: 'Function',
      insertText: 'pgm_read_byte(${1:address})',
      isSnippet: true,
      detail: 'uint8_t pgm_read_byte(const void *addr)',
      documentation: 'Read a byte from program memory (PROGMEM).',
      signature: 'uint8_t pgm_read_byte(const void *addr)'
    },
    {
      label: 'pgm_read_word',
      kind: 'Function',
      insertText: 'pgm_read_word(${1:address})',
      isSnippet: true,
      detail: 'uint16_t pgm_read_word(const void *addr)',
      documentation: 'Read a 16-bit word from program memory (PROGMEM).',
      signature: 'uint16_t pgm_read_word(const void *addr)'
    },
    {
      label: 'pgm_read_dword',
      kind: 'Function',
      insertText: 'pgm_read_dword(${1:address})',
      isSnippet: true,
      detail: 'uint32_t pgm_read_dword(const void *addr)',
      documentation: 'Read a 32-bit double-word from program memory (PROGMEM).',
      signature: 'uint32_t pgm_read_dword(const void *addr)'
    },
    {
      label: 'pgm_read_float',
      kind: 'Function',
      insertText: 'pgm_read_float(${1:address})',
      isSnippet: true,
      detail: 'float pgm_read_float(const void *addr)',
      documentation: 'Read a float from program memory (PROGMEM).',
      signature: 'float pgm_read_float(const void *addr)'
    },
    /* ── Bit manipulation ────────────────────────────────────────────── */
    {
      label: 'bitRead',
      kind: 'Function',
      insertText: 'bitRead(${1:value}, ${2:bit})',
      isSnippet: true,
      detail: 'bitRead(value, bit)',
      documentation: 'Reads a specific bit of a value.\n\n**Returns:** 0 or 1.',
      signature: 'bitRead(value, bit)'
    },
    {
      label: 'bitWrite',
      kind: 'Function',
      insertText: 'bitWrite(${1:value}, ${2:bit}, ${3:bitvalue})',
      isSnippet: true,
      detail: 'bitWrite(value, bit, bitvalue)',
      documentation: 'Writes a specific bit of a numeric variable.',
      signature: 'bitWrite(value, bit, bitvalue)'
    },
    {
      label: 'bitSet',
      kind: 'Function',
      insertText: 'bitSet(${1:value}, ${2:bit})',
      isSnippet: true,
      detail: 'bitSet(value, bit)',
      documentation: 'Sets (writes 1 to) a specific bit of a numeric variable.',
      signature: 'bitSet(value, bit)'
    },
    {
      label: 'bitClear',
      kind: 'Function',
      insertText: 'bitClear(${1:value}, ${2:bit})',
      isSnippet: true,
      detail: 'bitClear(value, bit)',
      documentation: 'Clears (writes 0 to) a specific bit of a numeric variable.',
      signature: 'bitClear(value, bit)'
    },
    {
      label: 'bit',
      kind: 'Function',
      insertText: 'bit(${1:n})',
      isSnippet: true,
      detail: 'bit(n)',
      documentation: 'Computes the value of the specified bit (bit 0 is 1, bit 1 is 2, bit 2 is 4, etc.).',
      signature: 'bit(n)'
    },
    {
      label: 'lowByte',
      kind: 'Function',
      insertText: 'lowByte(${1:x})',
      isSnippet: true,
      detail: 'lowByte(x)',
      documentation: 'Extracts the low-order (rightmost) byte of a variable.',
      signature: 'lowByte(x)'
    },
    {
      label: 'highByte',
      kind: 'Function',
      insertText: 'highByte(${1:x})',
      isSnippet: true,
      detail: 'highByte(x)',
      documentation: 'Extracts the high-order (leftmost) byte of a word.',
      signature: 'highByte(x)'
    },
    {
      label: 'sizeof',
      kind: 'Keyword',
      insertText: 'sizeof(${1:type})',
      isSnippet: true,
      detail: 'sizeof(type)',
      documentation: 'Returns the number of bytes occupied by a variable or type.',
      signature: 'sizeof(type)'
    },
    /* ── Serial methods ──────────────────────────────────────────────── */
    {
      label: 'Serial.begin',
      kind: 'Function',
      insertText: 'Serial.begin(${1:9600})',
      isSnippet: true,
      detail: 'void Serial.begin(unsigned long baud)',
      documentation: 'Sets the data rate in bits per second (baud) for serial data transmission.',
      signature: 'void Serial.begin(unsigned long baud)'
    },
    {
      label: 'Serial.print',
      kind: 'Function',
      insertText: 'Serial.print(${1:val})',
      isSnippet: true,
      detail: 'size_t Serial.print(val)',
      documentation: 'Prints data to the serial port as human-readable ASCII text.',
      signature: 'size_t Serial.print(val)'
    },
    {
      label: 'Serial.println',
      kind: 'Function',
      insertText: 'Serial.println(${1:val})',
      isSnippet: true,
      detail: 'size_t Serial.println(val)',
      documentation: 'Prints data to the serial port followed by a carriage return and newline.',
      signature: 'size_t Serial.println(val)'
    },
    {
      label: 'Serial.write',
      kind: 'Function',
      insertText: 'Serial.write(${1:val})',
      isSnippet: true,
      detail: 'size_t Serial.write(uint8_t val)',
      documentation: 'Writes binary data to the serial port.',
      signature: 'size_t Serial.write(uint8_t val)'
    },
    {
      label: 'Serial.available',
      kind: 'Function',
      insertText: 'Serial.available()',
      isSnippet: false,
      detail: 'int Serial.available()',
      documentation: 'Returns the number of bytes available for reading from the serial port.',
      signature: 'int Serial.available()'
    },
    {
      label: 'Serial.read',
      kind: 'Function',
      insertText: 'Serial.read()',
      isSnippet: false,
      detail: 'int Serial.read()',
      documentation: 'Reads incoming serial data. Returns -1 if no data available.',
      signature: 'int Serial.read()'
    },
    /* ── EEPROM (commonly used with Arduboy) ─────────────────────────── */
    {
      label: 'EEPROM.read',
      kind: 'Function',
      insertText: 'EEPROM.read(${1:address})',
      isSnippet: true,
      detail: 'uint8_t EEPROM.read(int address)',
      documentation: 'Reads a byte from the EEPROM at the specified address.\n\n**Note:** Use addresses starting from `EEPROM_STORAGE_SPACE_START` (16) on Arduboy.',
      signature: 'uint8_t EEPROM.read(int address)'
    },
    {
      label: 'EEPROM.write',
      kind: 'Function',
      insertText: 'EEPROM.write(${1:address}, ${2:value})',
      isSnippet: true,
      detail: 'void EEPROM.write(int address, uint8_t value)',
      documentation: 'Writes a byte to the EEPROM at the specified address.\n\n**Warning:** EEPROM has limited write cycles (~100,000). Use `EEPROM.update()` instead to avoid unnecessary writes.',
      signature: 'void EEPROM.write(int address, uint8_t value)'
    },
    {
      label: 'EEPROM.update',
      kind: 'Function',
      insertText: 'EEPROM.update(${1:address}, ${2:value})',
      isSnippet: true,
      detail: 'void EEPROM.update(int address, uint8_t value)',
      documentation: 'Writes a byte only if the value is different from the one already stored. Saves EEPROM write cycles.',
      signature: 'void EEPROM.update(int address, uint8_t value)'
    },
    {
      label: 'EEPROM.get',
      kind: 'Function',
      insertText: 'EEPROM.get(${1:address}, ${2:data})',
      isSnippet: true,
      detail: 'T& EEPROM.get(int address, T &data)',
      documentation: 'Reads any data type or object from EEPROM starting at the specified address.',
      signature: 'T& EEPROM.get(int address, T &data)'
    },
    {
      label: 'EEPROM.put',
      kind: 'Function',
      insertText: 'EEPROM.put(${1:address}, ${2:data})',
      isSnippet: true,
      detail: 'T& EEPROM.put(int address, const T &data)',
      documentation: 'Writes any data type or object to EEPROM starting at the specified address. Only writes bytes that have changed.',
      signature: 'T& EEPROM.put(int address, const T &data)'
    },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Arduino Types / Keywords
   * ══════════════════════════════════════════════════════════════════════ */
  var ARDUINO_TYPES = [
    { label: 'byte',     kind: 'Keyword', insertText: 'byte',     detail: 'unsigned 8-bit (0–255)',      documentation: 'An alias for `uint8_t`. Stores an 8-bit unsigned number, from 0 to 255.', signature: 'typedef uint8_t byte' },
    { label: 'boolean',  kind: 'Keyword', insertText: 'boolean',  detail: 'true/false type',             documentation: 'A type that holds `true` or `false`.', signature: 'typedef bool boolean' },
    { label: 'uint8_t',  kind: 'Keyword', insertText: 'uint8_t',  detail: 'unsigned 8-bit (0–255)',      documentation: 'Unsigned 8-bit integer. Range: 0 to 255.', signature: 'uint8_t' },
    { label: 'int8_t',   kind: 'Keyword', insertText: 'int8_t',   detail: 'signed 8-bit (-128 to 127)',  documentation: 'Signed 8-bit integer. Range: -128 to 127.', signature: 'int8_t' },
    { label: 'uint16_t', kind: 'Keyword', insertText: 'uint16_t', detail: 'unsigned 16-bit (0–65535)',   documentation: 'Unsigned 16-bit integer. Range: 0 to 65535.', signature: 'uint16_t' },
    { label: 'int16_t',  kind: 'Keyword', insertText: 'int16_t',  detail: 'signed 16-bit',              documentation: 'Signed 16-bit integer. Range: -32768 to 32767.', signature: 'int16_t' },
    { label: 'uint32_t', kind: 'Keyword', insertText: 'uint32_t', detail: 'unsigned 32-bit',             documentation: 'Unsigned 32-bit integer.', signature: 'uint32_t' },
    { label: 'int32_t',  kind: 'Keyword', insertText: 'int32_t',  detail: 'signed 32-bit',              documentation: 'Signed 32-bit integer.', signature: 'int32_t' },
    { label: 'String',   kind: 'Class',   insertText: 'String',   detail: 'Arduino String class',        documentation: 'The String class allows you to use and manipulate strings of text. For Arduboy, prefer `F()` macros and PROGMEM to save RAM.', signature: 'class String' },
    { label: 'PROGMEM',  kind: 'Keyword', insertText: 'PROGMEM',  detail: 'Store data in flash memory',  documentation: 'Place data in program (flash) memory instead of SRAM. Read with `pgm_read_byte()`, `pgm_read_word()`, etc.\n\n**Example:**\n```cpp\nconst uint8_t bitmap[] PROGMEM = { ... };\n```', signature: 'PROGMEM' },
    { label: 'const',    kind: 'Keyword', insertText: 'const',    detail: 'Read-only qualifier',         documentation: 'Marks a variable as read-only (constant).', signature: 'const' },
    { label: 'static',   kind: 'Keyword', insertText: 'static',   detail: 'Static storage',              documentation: 'Persists a local variable across function calls, or limits file scope for globals.', signature: 'static' },
    { label: 'volatile',  kind: 'Keyword', insertText: 'volatile',  detail: 'Volatile qualifier',        documentation: 'Tells the compiler the variable may change outside normal program flow (e.g. in an ISR).', signature: 'volatile' },
    { label: 'unsigned', kind: 'Keyword', insertText: 'unsigned', detail: 'Unsigned type modifier',      documentation: 'Modifier for integer types to use only non-negative values.', signature: 'unsigned' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Arduino Constants
   * ══════════════════════════════════════════════════════════════════════ */
  var ARDUINO_CONSTANTS = [
    { label: 'HIGH',         kind: 'Constant', insertText: 'HIGH',         detail: '1',            documentation: 'Pin voltage level HIGH (5V on ATmega).', signature: '#define HIGH 0x1' },
    { label: 'LOW',          kind: 'Constant', insertText: 'LOW',          detail: '0',            documentation: 'Pin voltage level LOW (0V).', signature: '#define LOW 0x0' },
    { label: 'INPUT',        kind: 'Constant', insertText: 'INPUT',        detail: 'Pin mode',     documentation: 'Configure a pin as an input (high impedance).', signature: '#define INPUT 0x0' },
    { label: 'OUTPUT',       kind: 'Constant', insertText: 'OUTPUT',       detail: 'Pin mode',     documentation: 'Configure a pin as an output.', signature: '#define OUTPUT 0x1' },
    { label: 'INPUT_PULLUP', kind: 'Constant', insertText: 'INPUT_PULLUP', detail: 'Pin mode',     documentation: 'Configure a pin as input with internal pull-up resistor enabled.', signature: '#define INPUT_PULLUP 0x2' },
    { label: 'LED_BUILTIN',  kind: 'Constant', insertText: 'LED_BUILTIN',  detail: 'Built-in LED', documentation: 'The pin number for the built-in LED.', signature: '#define LED_BUILTIN 13' },
    { label: 'true',         kind: 'Constant', insertText: 'true',         detail: 'Boolean true',  documentation: 'Boolean true value (1).', signature: 'true' },
    { label: 'false',        kind: 'Constant', insertText: 'false',        detail: 'Boolean false', documentation: 'Boolean false value (0).', signature: 'false' },
    { label: 'PI',           kind: 'Constant', insertText: 'PI',           detail: '3.14159...',    documentation: 'The constant PI (3.1415926535897932384626433832795).', signature: '#define PI 3.14159265...' },
    { label: 'TWO_PI',       kind: 'Constant', insertText: 'TWO_PI',       detail: '6.28318...',    documentation: 'TWO_PI (2 * PI).', signature: '#define TWO_PI 6.28318530...' },
    { label: 'HALF_PI',      kind: 'Constant', insertText: 'HALF_PI',      detail: '1.57079...',    documentation: 'HALF_PI (PI / 2).', signature: '#define HALF_PI 1.57079632...' },
    { label: 'DEG_TO_RAD',   kind: 'Constant', insertText: 'DEG_TO_RAD',   detail: '0.01745...',    documentation: 'Multiply degrees by this to convert to radians.', signature: '#define DEG_TO_RAD 0.01745329...' },
    { label: 'RAD_TO_DEG',   kind: 'Constant', insertText: 'RAD_TO_DEG',   detail: '57.2957...',    documentation: 'Multiply radians by this to convert to degrees.', signature: '#define RAD_TO_DEG 57.29577951...' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Arduboy Constants
   * ══════════════════════════════════════════════════════════════════════ */
  var ARDUBOY_CONSTANTS = [
    { label: 'WIDTH',          kind: 'Constant', insertText: 'WIDTH',          detail: '128',          documentation: 'Display width in pixels (128 for standard Arduboy).', signature: '#define WIDTH 128' },
    { label: 'HEIGHT',         kind: 'Constant', insertText: 'HEIGHT',         detail: '64',           documentation: 'Display height in pixels (64 for standard Arduboy).', signature: '#define HEIGHT 64' },
    { label: 'BLACK',          kind: 'Constant', insertText: 'BLACK',          detail: '0',            documentation: 'Color value for an unlit (off) pixel.', signature: '#define BLACK 0' },
    { label: 'WHITE',          kind: 'Constant', insertText: 'WHITE',          detail: '1',            documentation: 'Color value for a lit (on) pixel.', signature: '#define WHITE 1' },
    { label: 'INVERT',         kind: 'Constant', insertText: 'INVERT',        detail: '2',            documentation: 'Color value to invert pixels. Only supported by `drawBitmap()`.', signature: '#define INVERT 2' },
    { label: 'CLEAR_BUFFER',   kind: 'Constant', insertText: 'CLEAR_BUFFER',  detail: 'true',         documentation: 'Pass to `display(CLEAR_BUFFER)` to copy the buffer to the display AND clear it. Faster than separate `display()` + `clear()`.', signature: '#define CLEAR_BUFFER true' },
    { label: 'A_BUTTON',       kind: 'Constant', insertText: 'A_BUTTON',      detail: 'Button mask',  documentation: 'Bitmask for the A button. Use with `pressed()`, `justPressed()`, etc.', signature: '#define A_BUTTON _BV(3)' },
    { label: 'B_BUTTON',       kind: 'Constant', insertText: 'B_BUTTON',      detail: 'Button mask',  documentation: 'Bitmask for the B button.', signature: '#define B_BUTTON _BV(2)' },
    { label: 'UP_BUTTON',      kind: 'Constant', insertText: 'UP_BUTTON',     detail: 'Button mask',  documentation: 'Bitmask for the Up D-pad button.', signature: '#define UP_BUTTON _BV(7)' },
    { label: 'DOWN_BUTTON',    kind: 'Constant', insertText: 'DOWN_BUTTON',   detail: 'Button mask',  documentation: 'Bitmask for the Down D-pad button.', signature: '#define DOWN_BUTTON _BV(4)' },
    { label: 'LEFT_BUTTON',    kind: 'Constant', insertText: 'LEFT_BUTTON',   detail: 'Button mask',  documentation: 'Bitmask for the Left D-pad button.', signature: '#define LEFT_BUTTON _BV(5)' },
    { label: 'RIGHT_BUTTON',   kind: 'Constant', insertText: 'RIGHT_BUTTON',  detail: 'Button mask',  documentation: 'Bitmask for the Right D-pad button.', signature: '#define RIGHT_BUTTON _BV(6)' },
    { label: 'RGB_ON',         kind: 'Constant', insertText: 'RGB_ON',        detail: 'LOW',          documentation: 'Value to turn an RGB LED on (active low) with `digitalWriteRGB()`.', signature: '#define RGB_ON LOW' },
    { label: 'RGB_OFF',        kind: 'Constant', insertText: 'RGB_OFF',       detail: 'HIGH',         documentation: 'Value to turn an RGB LED off with `digitalWriteRGB()`.', signature: '#define RGB_OFF HIGH' },
    { label: 'RED_LED',        kind: 'Constant', insertText: 'RED_LED',       detail: '10',           documentation: 'Pin number for the red LED in the RGB LED.', signature: '#define RED_LED 10' },
    { label: 'GREEN_LED',      kind: 'Constant', insertText: 'GREEN_LED',     detail: '11',           documentation: 'Pin number for the green LED.', signature: '#define GREEN_LED 11' },
    { label: 'BLUE_LED',       kind: 'Constant', insertText: 'BLUE_LED',      detail: '9',            documentation: 'Pin number for the blue LED.', signature: '#define BLUE_LED 9' },
    { label: 'EEPROM_STORAGE_SPACE_START', kind: 'Constant', insertText: 'EEPROM_STORAGE_SPACE_START', detail: '16', documentation: 'First EEPROM address available for sketch use. System uses addresses 0–15.', signature: '#define EEPROM_STORAGE_SPACE_START 16' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Arduboy Class Names / Structs
   * ══════════════════════════════════════════════════════════════════════ */
  var ARDUBOY_CLASSES = [
    { label: 'Arduboy2',  kind: 'Class',  insertText: 'Arduboy2',  detail: 'class Arduboy2 : public Print, public Arduboy2Base', documentation: 'The main Arduboy2 class. Provides all drawing, input, frame timing, and text functions.\n\nDeclare a global instance:\n```cpp\nArduboy2 arduboy;\n```', signature: 'class Arduboy2' },
    { label: 'Arduboy2Base', kind: 'Class', insertText: 'Arduboy2Base', detail: 'class Arduboy2Base : public Arduboy2Core', documentation: 'Base class without text/print functions. Saves ~1.2KB if you don\'t need text output.\n\n```cpp\nArduboy2Base arduboy;\n```', signature: 'class Arduboy2Base' },
    { label: 'Sprites',   kind: 'Class',  insertText: 'Sprites',   detail: 'class Sprites',  documentation: 'Class for drawing animated sprites from PROGMEM arrays with various masking modes.\n\n```cpp\nSprites sprites;\n```', signature: 'class Sprites' },
    { label: 'SpritesB',  kind: 'Class',  insertText: 'SpritesB',  detail: 'class SpritesB', documentation: 'Like `Sprites` but optimized for small code size instead of speed.\n\n```cpp\nSpritesB sprites;\n```', signature: 'class SpritesB' },
    { label: 'BeepPin1',  kind: 'Class',  insertText: 'BeepPin1',  detail: 'class BeepPin1',  documentation: 'Play square wave tones on speaker pin 1. Uses a 16-bit timer for wide frequency range (15Hz–1MHz).\n\n```cpp\nBeepPin1 beep;\n```', signature: 'class BeepPin1' },
    { label: 'BeepPin2',  kind: 'Class',  insertText: 'BeepPin2',  detail: 'class BeepPin2',  documentation: 'Play square wave tones on speaker pin 2. Uses a 10-bit timer (61Hz–15625Hz).\n\n```cpp\nBeepPin2 beep;\n```', signature: 'class BeepPin2' },
    { label: 'Rect',      kind: 'Struct', insertText: 'Rect(${1:x}, ${2:y}, ${3:width}, ${4:height})', isSnippet: true, detail: 'struct Rect { int16_t x, y; uint8_t width, height; }', documentation: 'A rectangle for collision detection.\n\n```cpp\nRect myRect(10, 20, 16, 16);\n```', signature: 'struct Rect' },
    { label: 'Point',     kind: 'Struct', insertText: 'Point(${1:x}, ${2:y})', isSnippet: true, detail: 'struct Point { int16_t x, y; }', documentation: 'A point for collision detection.\n\n```cpp\nPoint myPoint(64, 32);\n```', signature: 'struct Point' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Arduboy2 Instance Methods
   * ══════════════════════════════════════════════════════════════════════ */
  var ARDUBOY2_METHODS = [
    /* ── Lifecycle ─────────────────────────────────────────────────────── */
    { label: 'begin',         kind: 'Method', insertText: 'begin()',             isSnippet: false, detail: 'void Arduboy2::begin()',   documentation: 'Initialize the hardware, display the boot logo, and set up audio control. Call once in `setup()`.\n\nThis is the standard way to start. If you need to save code space, use `boot()` instead.', signature: 'void begin()' },
    { label: 'boot',          kind: 'Method', insertText: 'boot()',              isSnippet: false, detail: 'void Arduboy2::boot()',    documentation: 'Initialize hardware only (no logo, no flashlight, no system buttons). Saves code space over `begin()`. You should call `flashlight()` or `safeMode()` after.', signature: 'void boot()' },
    { label: 'flashlight',    kind: 'Method', insertText: 'flashlight()',        isSnippet: false, detail: 'void flashlight()',        documentation: 'Turn the screen and RGB LED fully on if UP button is held at boot. Provides a way to enter bootloader for re-flashing. Called automatically by `begin()`.', signature: 'void flashlight()' },
    { label: 'systemButtons', kind: 'Method', insertText: 'systemButtons()',     isSnippet: false, detail: 'void systemButtons()',     documentation: 'Handle system control buttons on startup (hold B, then UP for sound on, DOWN for sound off). Called automatically by `begin()`.', signature: 'void systemButtons()' },
    { label: 'waitNoButtons', kind: 'Method', insertText: 'waitNoButtons()',     isSnippet: false, detail: 'void waitNoButtons()',     documentation: 'Wait until all buttons are released. Called at end of `begin()` to prevent accidental inputs.', signature: 'void waitNoButtons()' },

    /* ── Display ───────────────────────────────────────────────────────── */
    { label: 'clear',         kind: 'Method', insertText: 'clear()',             isSnippet: false, detail: 'void Arduboy2::clear()',   documentation: 'Clear the display buffer (all pixels set to BLACK). Also resets the text cursor to (0,0).', signature: 'void clear()' },
    { label: 'display',       kind: 'Method', insertText: 'display()',           isSnippet: false, detail: 'void Arduboy2::display()', documentation: 'Copy the display buffer to the screen.\n\nOptionally pass `true` or `CLEAR_BUFFER` to clear the buffer after copying (faster than separate `display()` + `clear()`).\n\n```cpp\narduboy.display(CLEAR_BUFFER);\n```', signature: 'void display() / void display(bool clear)' },
    { label: 'fillScreen',    kind: 'Method', insertText: 'fillScreen(${1|WHITE,BLACK|})', isSnippet: true, detail: 'void fillScreen(uint8_t color)', documentation: 'Fill the entire screen buffer with the specified color.', signature: 'void fillScreen(uint8_t color)' },
    { label: 'invert',        kind: 'Method', insertText: 'invert(${1|true,false|})', isSnippet: true, detail: 'void invert(bool inverse)', documentation: 'Invert the display (BLACK becomes lit, WHITE becomes unlit) or return to normal.', signature: 'void invert(bool inverse)' },

    /* ── Drawing primitives ────────────────────────────────────────────── */
    { label: 'drawPixel',     kind: 'Method', insertText: 'drawPixel(${1:x}, ${2:y}, ${3:WHITE})',            isSnippet: true, detail: 'void drawPixel(int16_t x, int16_t y, uint8_t color = WHITE)',     documentation: 'Set a single pixel.\n\n**Parameters:**\n- `x, y` — coordinates\n- `color` — `WHITE`, `BLACK` (default: WHITE)', signature: 'void drawPixel(int16_t x, int16_t y, uint8_t color = WHITE)' },
    { label: 'getPixel',      kind: 'Method', insertText: 'getPixel(${1:x}, ${2:y})',                          isSnippet: true, detail: 'uint8_t getPixel(uint8_t x, uint8_t y)',                          documentation: 'Returns the color (`WHITE` or `BLACK`) of the pixel at the given coordinates in the screen buffer.', signature: 'uint8_t getPixel(uint8_t x, uint8_t y)' },
    { label: 'drawLine',      kind: 'Method', insertText: 'drawLine(${1:x0}, ${2:y0}, ${3:x1}, ${4:y1}, ${5:WHITE})', isSnippet: true, detail: 'void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint8_t color = WHITE)', documentation: 'Draw a line between two points.\n\n**Parameters:**\n- `x0, y0` — start\n- `x1, y1` — end\n- `color` — `WHITE` or `BLACK`', signature: 'void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint8_t color = WHITE)' },
    { label: 'drawFastHLine', kind: 'Method', insertText: 'drawFastHLine(${1:x}, ${2:y}, ${3:w}, ${4:WHITE})',  isSnippet: true, detail: 'void drawFastHLine(int16_t x, int16_t y, uint8_t w, uint8_t color = WHITE)', documentation: 'Draw a horizontal line. Faster than `drawLine()` for horizontal lines.', signature: 'void drawFastHLine(int16_t x, int16_t y, uint8_t w, uint8_t color = WHITE)' },
    { label: 'drawFastVLine', kind: 'Method', insertText: 'drawFastVLine(${1:x}, ${2:y}, ${3:h}, ${4:WHITE})',  isSnippet: true, detail: 'void drawFastVLine(int16_t x, int16_t y, uint8_t h, uint8_t color = WHITE)', documentation: 'Draw a vertical line. Faster than `drawLine()` for vertical lines.', signature: 'void drawFastVLine(int16_t x, int16_t y, uint8_t h, uint8_t color = WHITE)' },
    { label: 'drawRect',      kind: 'Method', insertText: 'drawRect(${1:x}, ${2:y}, ${3:w}, ${4:h}, ${5:WHITE})', isSnippet: true, detail: 'void drawRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t color = WHITE)', documentation: 'Draw a rectangle outline.\n\n**Parameters:**\n- `x, y` — top-left\n- `w, h` — width and height\n- `color` — `WHITE` or `BLACK`', signature: 'void drawRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t color = WHITE)' },
    { label: 'fillRect',      kind: 'Method', insertText: 'fillRect(${1:x}, ${2:y}, ${3:w}, ${4:h}, ${5:WHITE})', isSnippet: true, detail: 'void fillRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t color = WHITE)', documentation: 'Draw a filled rectangle.', signature: 'void fillRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t color = WHITE)' },
    { label: 'drawCircle',    kind: 'Method', insertText: 'drawCircle(${1:x0}, ${2:y0}, ${3:r}, ${4:WHITE})',    isSnippet: true, detail: 'void drawCircle(int16_t x0, int16_t y0, uint8_t r, uint8_t color = WHITE)', documentation: 'Draw a circle outline.\n\n**Parameters:**\n- `x0, y0` — center\n- `r` — radius\n- `color` — `WHITE` or `BLACK`', signature: 'void drawCircle(int16_t x0, int16_t y0, uint8_t r, uint8_t color = WHITE)' },
    { label: 'fillCircle',    kind: 'Method', insertText: 'fillCircle(${1:x0}, ${2:y0}, ${3:r}, ${4:WHITE})',    isSnippet: true, detail: 'void fillCircle(int16_t x0, int16_t y0, uint8_t r, uint8_t color = WHITE)', documentation: 'Draw a filled circle.', signature: 'void fillCircle(int16_t x0, int16_t y0, uint8_t r, uint8_t color = WHITE)' },
    { label: 'drawRoundRect',  kind: 'Method', insertText: 'drawRoundRect(${1:x}, ${2:y}, ${3:w}, ${4:h}, ${5:r}, ${6:WHITE})', isSnippet: true, detail: 'void drawRoundRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t r, uint8_t color = WHITE)', documentation: 'Draw a rectangle with rounded corners.', signature: 'void drawRoundRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t r, uint8_t color = WHITE)' },
    { label: 'fillRoundRect',  kind: 'Method', insertText: 'fillRoundRect(${1:x}, ${2:y}, ${3:w}, ${4:h}, ${5:r}, ${6:WHITE})', isSnippet: true, detail: 'void fillRoundRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t r, uint8_t color = WHITE)', documentation: 'Draw a filled rectangle with rounded corners.', signature: 'void fillRoundRect(int16_t x, int16_t y, uint8_t w, uint8_t h, uint8_t r, uint8_t color = WHITE)' },
    { label: 'drawTriangle',  kind: 'Method', insertText: 'drawTriangle(${1:x0}, ${2:y0}, ${3:x1}, ${4:y1}, ${5:x2}, ${6:y2}, ${7:WHITE})', isSnippet: true, detail: 'void drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint8_t color = WHITE)', documentation: 'Draw a triangle outline given three corner coordinates.', signature: 'void drawTriangle(...)' },
    { label: 'fillTriangle',  kind: 'Method', insertText: 'fillTriangle(${1:x0}, ${2:y0}, ${3:x1}, ${4:y1}, ${5:x2}, ${6:y2}, ${7:WHITE})', isSnippet: true, detail: 'void fillTriangle(...)', documentation: 'Draw a filled triangle given three corner coordinates.', signature: 'void fillTriangle(...)' },

    /* ── Bitmaps ───────────────────────────────────────────────────────── */
    { label: 'drawBitmap',     kind: 'Method', insertText: 'drawBitmap(${1:x}, ${2:y}, ${3:bitmap}, ${4:w}, ${5:h}, ${6:WHITE})', isSnippet: true, detail: 'void drawBitmap(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t w, uint8_t h, uint8_t color = WHITE)', documentation: 'Draw a bitmap from a PROGMEM array. Height must be a multiple of 8.\n\n**Parameters:**\n- `x, y` — top-left\n- `bitmap` — pointer to PROGMEM array\n- `w, h` — width and height (h must be multiple of 8)\n- `color` — `WHITE`, `BLACK`, or `INVERT`', signature: 'void drawBitmap(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t w, uint8_t h, uint8_t color = WHITE)' },
    { label: 'drawCompressed', kind: 'Method', insertText: 'drawCompressed(${1:sx}, ${2:sy}, ${3:bitmap}, ${4:WHITE})', isSnippet: true, detail: 'void drawCompressed(int16_t sx, int16_t sy, const uint8_t *bitmap, uint8_t color = WHITE)', documentation: 'Draw a bitmap from a RLE compressed PROGMEM array.', signature: 'void drawCompressed(int16_t sx, int16_t sy, const uint8_t *bitmap, uint8_t color = WHITE)' },
    { label: 'drawSlowXYBitmap', kind: 'Method', insertText: 'drawSlowXYBitmap(${1:x}, ${2:y}, ${3:bitmap}, ${4:w}, ${5:h}, ${6:WHITE})', isSnippet: true, detail: 'void drawSlowXYBitmap(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t w, uint8_t h, uint8_t color = WHITE)', documentation: 'Draw a horizontally-oriented bitmap from PROGMEM. Slower than `drawBitmap()` but supports any height.', signature: 'void drawSlowXYBitmap(...)' },

    /* ── Text (from Print) ─────────────────────────────────────────────── */
    { label: 'print',         kind: 'Method', insertText: 'print(${1:val})',         isSnippet: true, detail: 'size_t print(val)',     documentation: 'Print text or value at the current cursor position.\n\n**Tip:** Use `F("string")` to keep strings in flash.\n```cpp\narduboy.print(F("Score: "));\narduboy.print(score);\n```', signature: 'size_t print(val)' },
    { label: 'println',       kind: 'Method', insertText: 'println(${1:val})',       isSnippet: true, detail: 'size_t println(val)',   documentation: 'Print text or value followed by a newline.', signature: 'size_t println(val)' },
    { label: 'write',         kind: 'Method', insertText: 'write(${1:c})',           isSnippet: true, detail: 'size_t write(uint8_t c)', documentation: 'Write a single character at the current cursor position.', signature: 'size_t write(uint8_t c)' },
    { label: 'setCursor',     kind: 'Method', insertText: 'setCursor(${1:x}, ${2:y})', isSnippet: true, detail: 'void setCursor(int16_t x, int16_t y)', documentation: 'Set the text cursor position in pixels. (0,0) is the top-left corner.', signature: 'void setCursor(int16_t x, int16_t y)' },
    { label: 'getCursorX',    kind: 'Method', insertText: 'getCursorX()',            isSnippet: false, detail: 'int16_t getCursorX()',   documentation: 'Get the current X text cursor position.', signature: 'int16_t getCursorX()' },
    { label: 'getCursorY',    kind: 'Method', insertText: 'getCursorY()',            isSnippet: false, detail: 'int16_t getCursorY()',   documentation: 'Get the current Y text cursor position.', signature: 'int16_t getCursorY()' },
    { label: 'setTextSize',   kind: 'Method', insertText: 'setTextSize(${1:1})',     isSnippet: true, detail: 'void setTextSize(uint8_t s)', documentation: 'Set the text size multiplier. 1 = standard (6x8 pixels per character), 2 = double, etc.', signature: 'void setTextSize(uint8_t s)' },
    { label: 'setTextColor',  kind: 'Method', insertText: 'setTextColor(${1|WHITE,BLACK|})', isSnippet: true, detail: 'void setTextColor(uint8_t color)', documentation: 'Set the text foreground color to `WHITE` or `BLACK`.', signature: 'void setTextColor(uint8_t color)' },
    { label: 'setTextBackground', kind: 'Method', insertText: 'setTextBackground(${1|BLACK,WHITE|})', isSnippet: true, detail: 'void setTextBackground(uint8_t bg)', documentation: 'Set the text background color. Set to same as text color for transparent background.', signature: 'void setTextBackground(uint8_t bg)' },
    { label: 'setTextWrap',   kind: 'Method', insertText: 'setTextWrap(${1|true,false|})', isSnippet: true, detail: 'void setTextWrap(bool w)', documentation: 'Enable or disable text wrapping at the right edge of the display.', signature: 'void setTextWrap(bool w)' },
    { label: 'getTextColor',  kind: 'Method', insertText: 'getTextColor()',          isSnippet: false, detail: 'uint8_t getTextColor()', documentation: 'Get the current text foreground color.', signature: 'uint8_t getTextColor()' },
    { label: 'getTextBackground', kind: 'Method', insertText: 'getTextBackground()', isSnippet: false, detail: 'uint8_t getTextBackground()', documentation: 'Get the current text background color.', signature: 'uint8_t getTextBackground()' },
    { label: 'getTextSize',   kind: 'Method', insertText: 'getTextSize()',           isSnippet: false, detail: 'uint8_t getTextSize()',  documentation: 'Get the current text size multiplier.', signature: 'uint8_t getTextSize()' },
    { label: 'getTextWrap',   kind: 'Method', insertText: 'getTextWrap()',           isSnippet: false, detail: 'bool getTextWrap()',     documentation: 'Get whether text wrapping is enabled.', signature: 'bool getTextWrap()' },
    { label: 'setFont',       kind: 'Method', insertText: 'setFont(${1:font})',      isSnippet: true, detail: 'void setFont(const uint8_t *f, uint8_t w, uint8_t h)', documentation: 'Set a custom font for text output. Font data must be in PROGMEM.', signature: 'void setFont(...)' },

    /* ── Frame control ─────────────────────────────────────────────────── */
    { label: 'setFrameRate',  kind: 'Method', insertText: 'setFrameRate(${1:60})',   isSnippet: true, detail: 'void setFrameRate(uint8_t rate)', documentation: 'Set the target frame rate in frames per second. Default is 60.\n\n**Note:** Due to integer rounding, 60 FPS actually results in ~62.5 FPS (16ms per frame).', signature: 'void setFrameRate(uint8_t rate)' },
    { label: 'nextFrame',     kind: 'Method', insertText: 'nextFrame()',             isSnippet: false, detail: 'bool nextFrame()',       documentation: 'Returns `true` when it is time to render the next frame. Call at the start of `loop()` and return early if `false`.\n\n```cpp\nif (!arduboy.nextFrame()) return;\n```', signature: 'bool nextFrame()' },
    { label: 'everyXFrames',  kind: 'Method', insertText: 'everyXFrames(${1:frames})', isSnippet: true, detail: 'bool everyXFrames(uint8_t frames)', documentation: 'Returns `true` every N frames. Useful for timing animations and events.\n\n```cpp\nif (arduboy.everyXFrames(30)) {\n  // Runs every half second at 60fps\n}\n```', signature: 'bool everyXFrames(uint8_t frames)' },
    { label: 'idle',          kind: 'Method', insertText: 'idle()',                  isSnippet: false, detail: 'void idle()',             documentation: 'Idle the CPU to save power. Call in `loop()` when `nextFrame()` returns false.', signature: 'void idle()' },
    { label: 'frameCount',    kind: 'Field',  insertText: 'frameCount',              isSnippet: false, detail: 'uint16_t frameCount',    documentation: 'A counter incremented once per frame by `nextFrame()`. Wraps at 65535.', signature: 'static uint16_t frameCount' },
    { label: 'cpuLoad',       kind: 'Method', insertText: 'cpuLoad()',               isSnippet: false, detail: 'int cpuLoad()',           documentation: 'Returns CPU load as a percentage of frame time. Values over 100 indicate the frame rate is too high.', signature: 'int cpuLoad()' },

    /* ── Input ─────────────────────────────────────────────────────────── */
    { label: 'pressed',       kind: 'Method', insertText: 'pressed(${1|A_BUTTON,B_BUTTON,UP_BUTTON,DOWN_BUTTON,LEFT_BUTTON,RIGHT_BUTTON|})', isSnippet: true, detail: 'bool pressed(uint8_t buttons)', documentation: 'Returns `true` if ALL specified buttons are currently pressed. No debouncing.\n\nCan combine buttons: `pressed(LEFT_BUTTON | A_BUTTON)`', signature: 'bool pressed(uint8_t buttons)' },
    { label: 'notPressed',    kind: 'Method', insertText: 'notPressed(${1:buttons})', isSnippet: true, detail: 'bool notPressed(uint8_t buttons)', documentation: 'Returns `true` if ALL specified buttons are currently released.', signature: 'bool notPressed(uint8_t buttons)' },
    { label: 'anyPressed',    kind: 'Method', insertText: 'anyPressed(${1:buttons})', isSnippet: true, detail: 'bool anyPressed(uint8_t buttons)', documentation: 'Returns `true` if ANY of the specified buttons are currently pressed.', signature: 'bool anyPressed(uint8_t buttons)' },
    { label: 'justPressed',   kind: 'Method', insertText: 'justPressed(${1|A_BUTTON,B_BUTTON,UP_BUTTON,DOWN_BUTTON,LEFT_BUTTON,RIGHT_BUTTON|})', isSnippet: true, detail: 'bool justPressed(uint8_t button)', documentation: 'Returns `true` if the button was pressed since the last call to `pollButtons()`. Only test one button at a time.\n\n**Requires:** `pollButtons()` called once per frame.', signature: 'bool justPressed(uint8_t button)' },
    { label: 'justReleased',  kind: 'Method', insertText: 'justReleased(${1|A_BUTTON,B_BUTTON,UP_BUTTON,DOWN_BUTTON,LEFT_BUTTON,RIGHT_BUTTON|})', isSnippet: true, detail: 'bool justReleased(uint8_t button)', documentation: 'Returns `true` if the button was released since the last call to `pollButtons()`.', signature: 'bool justReleased(uint8_t button)' },
    { label: 'pollButtons',   kind: 'Method', insertText: 'pollButtons()',           isSnippet: false, detail: 'void pollButtons()',     documentation: 'Read and save button states for use by `justPressed()` and `justReleased()`. Call once at the start of each frame.\n\n```cpp\narduboy.pollButtons();\nif (arduboy.justPressed(A_BUTTON)) { ... }\n```', signature: 'void pollButtons()' },
    { label: 'buttonsState',  kind: 'Method', insertText: 'buttonsState()',          isSnippet: false, detail: 'uint8_t buttonsState()', documentation: 'Returns the current raw button state bitmask.', signature: 'uint8_t buttonsState()' },

    /* ── Collision ─────────────────────────────────────────────────────── */
    { label: 'collide',       kind: 'Method', insertText: 'collide(${1:obj1}, ${2:obj2})', isSnippet: true, detail: 'bool collide(Point point, Rect rect) / bool collide(Rect rect1, Rect rect2)', documentation: 'Test collision between a `Point` and `Rect`, or between two `Rect` objects.\n\n**Returns:** `true` if the objects overlap.', signature: 'bool collide(Point, Rect) / bool collide(Rect, Rect)' },

    /* ── LED ───────────────────────────────────────────────────────────── */
    { label: 'setRGBled',      kind: 'Method', insertText: 'setRGBled(${1:red}, ${2:green}, ${3:blue})', isSnippet: true, detail: 'void setRGBled(uint8_t red, uint8_t green, uint8_t blue)', documentation: 'Set the brightness of the RGB LED. Each value 0–255.', signature: 'void setRGBled(uint8_t red, uint8_t green, uint8_t blue)' },
    { label: 'digitalWriteRGB', kind: 'Method', insertText: 'digitalWriteRGB(${1|RGB_ON,RGB_OFF|}, ${2|RGB_ON,RGB_OFF|}, ${3|RGB_ON,RGB_OFF|})', isSnippet: true, detail: 'void digitalWriteRGB(uint8_t r, uint8_t g, uint8_t b)', documentation: 'Set each RGB LED digitally to `RGB_ON` or `RGB_OFF`.', signature: 'void digitalWriteRGB(uint8_t red, uint8_t green, uint8_t blue)' },

    /* ── Utility ───────────────────────────────────────────────────────── */
    { label: 'initRandomSeed', kind: 'Method', insertText: 'initRandomSeed()',       isSnippet: false, detail: 'void initRandomSeed()',  documentation: 'Seed the random number generator with entropy from a floating ADC pin. Most effective if called after a user action (e.g. pressing start).', signature: 'void initRandomSeed()' },
    { label: 'generateRandomSeed', kind: 'Method', insertText: 'generateRandomSeed()', isSnippet: false, detail: 'unsigned long generateRandomSeed()', documentation: 'Create a random seed from ADC noise. Returns the seed value without applying it.', signature: 'unsigned long generateRandomSeed()' },

    /* ── Audio sub-object ──────────────────────────────────────────────── */
    { label: 'audio.on',       kind: 'Method', insertText: 'audio.on()',             isSnippet: false, detail: 'void Arduboy2Audio::on()',     documentation: 'Enable sound output. Use `audio.saveOnOff()` to persist.', signature: 'void audio.on()' },
    { label: 'audio.off',      kind: 'Method', insertText: 'audio.off()',            isSnippet: false, detail: 'void Arduboy2Audio::off()',    documentation: 'Mute sound output. Use `audio.saveOnOff()` to persist.', signature: 'void audio.off()' },
    { label: 'audio.toggle',   kind: 'Method', insertText: 'audio.toggle()',         isSnippet: false, detail: 'void Arduboy2Audio::toggle()', documentation: 'Toggle sound on/off.', signature: 'void audio.toggle()' },
    { label: 'audio.enabled',  kind: 'Method', insertText: 'audio.enabled()',        isSnippet: false, detail: 'bool Arduboy2Audio::enabled()', documentation: 'Returns `true` if sound is enabled.', signature: 'bool audio.enabled()' },
    { label: 'audio.saveOnOff', kind: 'Method', insertText: 'audio.saveOnOff()',     isSnippet: false, detail: 'void Arduboy2Audio::saveOnOff()', documentation: 'Save the current sound on/off state to EEPROM.', signature: 'void audio.saveOnOff()' },

    /* ── EEPROM helpers ────────────────────────────────────────────────── */
    { label: 'readUnitID',     kind: 'Method', insertText: 'readUnitID()',           isSnippet: false, detail: 'uint16_t readUnitID()',   documentation: 'Read the unit ID from system EEPROM.', signature: 'uint16_t readUnitID()' },
    { label: 'writeUnitID',    kind: 'Method', insertText: 'writeUnitID(${1:id})',   isSnippet: true, detail: 'void writeUnitID(uint16_t id)', documentation: 'Write a unit ID to system EEPROM.', signature: 'void writeUnitID(uint16_t id)' },
    { label: 'readUnitName',   kind: 'Method', insertText: 'readUnitName(${1:name})', isSnippet: true, detail: 'uint8_t readUnitName(char *name)', documentation: 'Read the unit name from system EEPROM into a char buffer.', signature: 'uint8_t readUnitName(char *name)' },
    { label: 'writeUnitName',  kind: 'Method', insertText: 'writeUnitName(${1:name})', isSnippet: true, detail: 'void writeUnitName(const char *name)', documentation: 'Write a unit name to system EEPROM.', signature: 'void writeUnitName(const char *name)' },
    { label: 'readShowBootLogoFlag', kind: 'Method', insertText: 'readShowBootLogoFlag()', isSnippet: false, detail: 'bool readShowBootLogoFlag()', documentation: 'Read the flag controlling whether the boot logo is displayed.', signature: 'bool readShowBootLogoFlag()' },
    { label: 'writeShowBootLogoFlag', kind: 'Method', insertText: 'writeShowBootLogoFlag(${1|true,false|})', isSnippet: true, detail: 'void writeShowBootLogoFlag(bool val)', documentation: 'Write the flag controlling boot logo display.', signature: 'void writeShowBootLogoFlag(bool val)' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Sprites Class Methods
   * ══════════════════════════════════════════════════════════════════════ */
  var SPRITES_METHODS = [
    { label: 'drawOverwrite',    kind: 'Method', insertText: 'drawOverwrite(${1:x}, ${2:y}, ${3:bitmap}, ${4:frame})',    isSnippet: true, detail: 'void Sprites::drawOverwrite(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)',    documentation: 'Draw a sprite by completely replacing existing pixels. A bit set to 1 sets the buffer pixel to 1; a 0 sets it to 0.\n\nThis is the simplest and fastest draw method.', signature: 'void drawOverwrite(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)' },
    { label: 'drawSelfMasked',   kind: 'Method', insertText: 'drawSelfMasked(${1:x}, ${2:y}, ${3:bitmap}, ${4:frame})',   isSnippet: true, detail: 'void Sprites::drawSelfMasked(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)',   documentation: 'Draw a sprite using only the bits set to 1 (OR operation). Bits set to 0 leave existing pixels unchanged.\n\nGood for drawing on a cleared screen.', signature: 'void drawSelfMasked(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)' },
    { label: 'drawErase',        kind: 'Method', insertText: 'drawErase(${1:x}, ${2:y}, ${3:bitmap}, ${4:frame})',        isSnippet: true, detail: 'void Sprites::drawErase(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)',        documentation: '"Erase" a sprite. Bits set to 1 in the frame will set the corresponding buffer pixel to 0 (BLACK).', signature: 'void drawErase(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)' },
    { label: 'drawPlusMask',     kind: 'Method', insertText: 'drawPlusMask(${1:x}, ${2:y}, ${3:bitmap}, ${4:frame})',     isSnippet: true, detail: 'void Sprites::drawPlusMask(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)',     documentation: 'Draw a sprite using combined image+mask data. The array alternates image/mask byte pairs. Mask bits of 1 apply the image; 0 leaves the buffer unchanged.\n\nThis is the most common method for sprites with transparency.', signature: 'void drawPlusMask(int16_t x, int16_t y, const uint8_t *bitmap, uint8_t frame)' },
    { label: 'drawExternalMask', kind: 'Method', insertText: 'drawExternalMask(${1:x}, ${2:y}, ${3:bitmap}, ${4:mask}, ${5:frame}, ${6:mask_frame})', isSnippet: true, detail: 'void Sprites::drawExternalMask(int16_t x, int16_t y, const uint8_t *bitmap, const uint8_t *mask, uint8_t frame, uint8_t mask_frame)', documentation: 'Draw a sprite using separate image and mask arrays. The mask can use a different frame number than the image.', signature: 'void drawExternalMask(int16_t x, int16_t y, const uint8_t *bitmap, const uint8_t *mask, uint8_t frame, uint8_t mask_frame)' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  BeepPin1 / BeepPin2 Methods
   * ══════════════════════════════════════════════════════════════════════ */
  var BEEP_METHODS = [
    { label: 'begin',    kind: 'Method', insertText: 'begin()',                  isSnippet: false, detail: 'void BeepPin::begin()',    documentation: 'Set up the hardware for playing tones. Must be called in `setup()`.', signature: 'void begin()' },
    { label: 'tone',     kind: 'Method', insertText: 'tone(${1:count}, ${2:duration})', isSnippet: true, detail: 'void BeepPin::tone(uint16_t count, uint8_t dur)', documentation: 'Play a tone. Use `freq()` to convert Hz to the count value.\n\n**Parameters:**\n- `count` — timer count (use `freq()` to convert from Hz)\n- `dur` — duration in `timer()` calls (typically frames)\n\n**Example:**\n```cpp\nbeep.tone(beep.freq(440), 30);\n```', signature: 'void tone(uint16_t count, uint8_t dur)' },
    { label: 'timer',    kind: 'Method', insertText: 'timer()',                  isSnippet: false, detail: 'void BeepPin::timer()',    documentation: 'Must be called once per frame to handle tone duration countdown. When duration reaches 0, the tone stops.\n\nCall in your `loop()` function.', signature: 'void timer()' },
    { label: 'noTone',   kind: 'Method', insertText: 'noTone()',                 isSnippet: false, detail: 'void BeepPin::noTone()',   documentation: 'Stop a playing tone immediately.', signature: 'void noTone()' },
    { label: 'freq',     kind: 'Method', insertText: 'freq(${1:hz})',            isSnippet: true, detail: 'constexpr uint16_t BeepPin::freq(float hz)', documentation: 'Convert a frequency in Hz to the timer count value for `tone()`. Use with constant values to avoid pulling in floating-point math.\n\n**Example:** `beep.tone(beep.freq(440), 30)` — play 440Hz for 30 frames.', signature: 'constexpr uint16_t freq(float hz)' },
    { label: 'duration', kind: 'Field',  insertText: 'duration',                isSnippet: false, detail: 'uint8_t BeepPin::duration', documentation: 'The countdown counter used by `timer()`. Non-zero means a tone is currently playing.', signature: 'static uint8_t duration' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Include snippets
   * ══════════════════════════════════════════════════════════════════════ */
  var INCLUDE_SNIPPETS = [
    { label: '#include <Arduboy2.h>',    kind: 'Snippet', insertText: '#include <Arduboy2.h>',    isSnippet: false, detail: 'Arduboy2 library',    documentation: 'Include the Arduboy2 library. Provides `Arduboy2`, `Arduboy2Base`, `Sprites`, `SpritesB`, `BeepPin1`, `BeepPin2`, `Rect`, `Point`.', signature: '#include <Arduboy2.h>' },
    { label: '#include <EEPROM.h>',      kind: 'Snippet', insertText: '#include <EEPROM.h>',      isSnippet: false, detail: 'EEPROM library',       documentation: 'Include the EEPROM library for persistent storage.', signature: '#include <EEPROM.h>' },
    { label: '#include <Arduino.h>',     kind: 'Snippet', insertText: '#include <Arduino.h>',     isSnippet: false, detail: 'Arduino core',         documentation: 'Include the Arduino core library. Usually not needed explicitly in `.ino` files.', signature: '#include <Arduino.h>' },
    { label: '#include <avr/pgmspace.h>', kind: 'Snippet', insertText: '#include <avr/pgmspace.h>', isSnippet: false, detail: 'AVR PROGMEM macros',  documentation: 'Include AVR PROGMEM macros for storing data in flash memory.', signature: '#include <avr/pgmspace.h>' },
    { label: '#include <SPI.h>',         kind: 'Snippet', insertText: '#include <SPI.h>',         isSnippet: false, detail: 'SPI library',          documentation: 'Include the SPI communication library.', signature: '#include <SPI.h>' },
  ];

  /* ══════════════════════════════════════════════════════════════════════
   *  Lookup table for hover documentation
   * ══════════════════════════════════════════════════════════════════════ */
  var ALL_DOC_ENTRIES = {};

  function buildDocLookup() {
    var allItems = [].concat(
      ARDUINO_FUNCTIONS, ARDUINO_TYPES, ARDUINO_CONSTANTS,
      ARDUBOY_CONSTANTS, ARDUBOY_CLASSES,
      ARDUBOY2_METHODS, SPRITES_METHODS, BEEP_METHODS,
      INCLUDE_SNIPPETS
    );
    allItems.forEach(function (item) {
      // Strip prefixes like "Serial." or "EEPROM." or "audio." for hover lookup
      var key = item.label.replace(/^(Serial|EEPROM|audio)\./, '');
      if (!ALL_DOC_ENTRIES[item.label]) {
        ALL_DOC_ENTRIES[item.label] = item;
      }
      if (key !== item.label && !ALL_DOC_ENTRIES[key]) {
        ALL_DOC_ENTRIES[key] = item;
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Helper — detect type of a variable name from model text
   * ══════════════════════════════════════════════════════════════════════ */
  function detectType(name, modelText) {
    // Match: Arduboy2 <name> or Arduboy2Base <name>
    if (new RegExp('Arduboy2(?:Base)?\\s+' + escapeRegex(name) + '\\b').test(modelText)) {
      return 'Arduboy2';
    }
    // Match: Sprites <name> or SpritesB <name>
    if (new RegExp('(?:Sprites|SpritesB)\\s+' + escapeRegex(name) + '\\b').test(modelText)) {
      return 'Sprites';
    }
    // Static access: Sprites:: or SpritesB::
    if (name === 'Sprites' || name === 'SpritesB') return 'Sprites';
    // Match: BeepPin1 <name> or BeepPin2 <name>
    if (new RegExp('(?:BeepPin1|BeepPin2)\\s+' + escapeRegex(name) + '\\b').test(modelText)) {
      return 'Beep';
    }
    // Match: Serial
    if (name === 'Serial') return 'Serial';
    // Match: EEPROM
    if (name === 'EEPROM') return 'EEPROM';
    return null;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Parse parameter labels from a signature string
   *  e.g. "void drawPixel(int16_t x, int16_t y, uint8_t color = WHITE)"
   *       → ["int16_t x", "int16_t y", "uint8_t color = WHITE"]
   * ══════════════════════════════════════════════════════════════════════ */
  function parseSignatureParams(signatureStr) {
    // Use only the first overload if there are multiple (separated by " / ")
    var sig = signatureStr.split(' / ')[0];

    var open  = sig.indexOf('(');
    var close = sig.lastIndexOf(')');
    if (open === -1 || close === -1 || close <= open + 1) return [];

    var inside = sig.substring(open + 1, close).trim();
    if (!inside || inside === 'void' || inside === '...') return [];

    var params = [];
    var depth  = 0;
    var start  = 0;

    for (var i = 0; i < inside.length; i++) {
      var c = inside[i];
      if (c === '(' || c === '<' || c === '[') { depth++; }
      else if (c === ')' || c === '>' || c === ']') { depth--; }
      else if (c === ',' && depth === 0) {
        params.push(inside.substring(start, i).trim());
        start = i + 1;
      }
    }
    params.push(inside.substring(start).trim());

    return params.filter(function (p) { return p.length > 0; });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Build suggestion objects for Monaco
   * ══════════════════════════════════════════════════════════════════════ */
  function buildSuggestions(items, range, monaco) {
    return items.map(function (item) {
      var kindMap = {
        'Function': monaco.languages.CompletionItemKind.Function,
        'Method':   monaco.languages.CompletionItemKind.Method,
        'Field':    monaco.languages.CompletionItemKind.Field,
        'Keyword':  monaco.languages.CompletionItemKind.Keyword,
        'Constant': monaco.languages.CompletionItemKind.Constant,
        'Class':    monaco.languages.CompletionItemKind.Class,
        'Struct':   monaco.languages.CompletionItemKind.Struct,
        'Snippet':  monaco.languages.CompletionItemKind.Snippet,
      };
      return {
        label: item.label,
        kind: kindMap[item.kind] || monaco.languages.CompletionItemKind.Text,
        insertText: item.insertText,
        insertTextRules: item.isSnippet
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        detail: item.detail || '',
        documentation: {
          value: item.documentation || '',
          isTrusted: true
        },
        range: range
      };
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Filter items for member access — strip "audio." prefix for matching
   * ══════════════════════════════════════════════════════════════════════ */
  function getMemberSuggestions(objectName, type, range, monaco, modelText) {
    switch (type) {
      case 'Arduboy2':
        return buildSuggestions(ARDUBOY2_METHODS, range, monaco);
      case 'Sprites':
        return buildSuggestions(SPRITES_METHODS, range, monaco);
      case 'Beep':
        return buildSuggestions(BEEP_METHODS, range, monaco);
      case 'Serial':
        return buildSuggestions(
          ARDUINO_FUNCTIONS.filter(function (f) { return f.label.indexOf('Serial.') === 0; }).map(function (f) {
            return Object.assign({}, f, { label: f.label.replace('Serial.', ''), insertText: f.insertText.replace('Serial.', '') });
          }),
          range, monaco
        );
      case 'EEPROM':
        return buildSuggestions(
          ARDUINO_FUNCTIONS.filter(function (f) { return f.label.indexOf('EEPROM.') === 0; }).map(function (f) {
            return Object.assign({}, f, { label: f.label.replace('EEPROM.', ''), insertText: f.insertText.replace('EEPROM.', '') });
          }),
          range, monaco
        );
      default:
        // If accessing .audio on an Arduboy2 instance, show audio methods
        if (objectName === 'audio') {
          var audioMethods = ARDUBOY2_METHODS.filter(function (m) { return m.label.indexOf('audio.') === 0; }).map(function (m) {
            return Object.assign({}, m, { label: m.label.replace('audio.', ''), insertText: m.insertText.replace('audio.', '') });
          });
          return buildSuggestions(audioMethods, range, monaco);
        }
        return [];
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   *  Public registration function
   * ══════════════════════════════════════════════════════════════════════ */
  window.ArduboyCompletions = {
    register: function (monaco) {
      buildDocLookup();

      /* ── Completion provider ────────────────────────────────────────── */
      monaco.languages.registerCompletionItemProvider('cpp', {
        triggerCharacters: ['.', '#'],

        provideCompletionItems: function (model, position) {
          var word = model.getWordUntilPosition(position);
          var range = {
            startLineNumber: position.lineNumber,
            endLineNumber:   position.lineNumber,
            startColumn:     word.startColumn,
            endColumn:       word.endColumn
          };

          var textUntilPos = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn:     1,
            endLineNumber:   position.lineNumber,
            endColumn:       position.column
          });

          var suggestions = [];
          var modelText = model.getValue();

          /* Check for #include completion */
          if (/^\s*#include\s*/.test(textUntilPos)) {
            return { suggestions: buildSuggestions(INCLUDE_SNIPPETS, range, monaco) };
          }

          /* Check for # directive start */
          if (/^\s*#\s*$/.test(textUntilPos)) {
            return {
              suggestions: buildSuggestions(INCLUDE_SNIPPETS, range, monaco)
            };
          }

          /* Check for member access (e.g., "arduboy." or "arduboy.audio.") */
          var memberMatch = textUntilPos.match(/(\w+)\.(\w+)\.\s*(\w*)$/);
          if (memberMatch) {
            // Two-level access like arduboy.audio.
            var subObject = memberMatch[2];
            suggestions = getMemberSuggestions(subObject, null, range, monaco, modelText);
            if (suggestions.length > 0) return { suggestions: suggestions };
          }

          var dotMatch = textUntilPos.match(/(\w+)\.\s*(\w*)$/);
          if (dotMatch) {
            var objName = dotMatch[1];
            var objType = detectType(objName, modelText);
            if (objType) {
              suggestions = getMemberSuggestions(objName, objType, range, monaco, modelText);
            }
            // If nothing detected, might be accessing audio sub-object
            if (suggestions.length === 0 && objName === 'audio') {
              suggestions = getMemberSuggestions('audio', null, range, monaco, modelText);
            }
            return { suggestions: suggestions };
          }

          /* Global context — show everything */
          suggestions = [].concat(
            buildSuggestions(ARDUINO_FUNCTIONS, range, monaco),
            buildSuggestions(ARDUINO_TYPES, range, monaco),
            buildSuggestions(ARDUINO_CONSTANTS, range, monaco),
            buildSuggestions(ARDUBOY_CONSTANTS, range, monaco),
            buildSuggestions(ARDUBOY_CLASSES, range, monaco),
            buildSuggestions(INCLUDE_SNIPPETS, range, monaco)
          );

          return { suggestions: suggestions };
        }
      });

      /* ── Hover provider ─────────────────────────────────────────────── */
      monaco.languages.registerHoverProvider('cpp', {
        provideHover: function (model, position) {
          // Suppress standard hover when bitmap inline icon is on this line
          if (window.BitmapDetector && window.BitmapDetector._hasBitmapIconNear &&
              window.BitmapDetector._hasBitmapIconNear(position.lineNumber, position.column)) {
            return null;
          }

          var word = model.getWordAtPosition(position);
          if (!word) return null;

          var entry = ALL_DOC_ENTRIES[word.word];
          if (!entry) return null;

          var contents = [];
          if (entry.signature) {
            contents.push({ value: '```cpp\n' + entry.signature + '\n```' });
          }
          if (entry.documentation) {
            contents.push({ value: entry.documentation });
          }

          return {
            range: new monaco.Range(
              position.lineNumber, word.startColumn,
              position.lineNumber, word.endColumn
            ),
            contents: contents
          };
        }
      });

      /* ── Signature help provider (parameter hints) ──────────────────── */
      monaco.languages.registerSignatureHelpProvider('cpp', {
        signatureHelpTriggerCharacters:   ['(', ','],
        signatureHelpRetriggerCharacters: [','],

        provideSignatureHelp: function (model, position) {
          var textUntilPos = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn:     1,
            endLineNumber:   position.lineNumber,
            endColumn:       position.column
          });

          /* Walk backwards to find the opening paren of the current call */
          var depth    = 0;
          var parenPos = -1;
          for (var i = textUntilPos.length - 1; i >= 0; i--) {
            var c = textUntilPos[i];
            if      (c === ')') { depth++; }
            else if (c === '(') {
              if (depth === 0) { parenPos = i; break; }
              depth--;
            }
          }
          if (parenPos === -1) return null;

          /* Extract the function / method name before the paren */
          var before      = textUntilPos.substring(0, parenPos);
          var methodMatch = before.match(/(\w+)\.(\w+)\s*$/);
          var plainMatch  = before.match(/(\w+)\s*$/);
          if (!methodMatch && !plainMatch) return null;

          /* Prefer "Object.method" key, fall back to bare name */
          var lookupKey = methodMatch
            ? methodMatch[1] + '.' + methodMatch[2]
            : plainMatch[1];
          var funcName = methodMatch ? methodMatch[2] : plainMatch[1];

          var entry = ALL_DOC_ENTRIES[lookupKey] || ALL_DOC_ENTRIES[funcName];
          if (!entry || !entry.signature) return null;

          /* Count commas at nesting depth 0 after the opening paren */
          var activeParam = 0;
          var d2 = 0;
          for (var j = parenPos + 1; j < textUntilPos.length; j++) {
            var ch = textUntilPos[j];
            if      (ch === '(' || ch === '[' || ch === '{') { d2++; }
            else if (ch === ')' || ch === ']' || ch === '}') { d2--; }
            else if (ch === ',' && d2 === 0) { activeParam++; }
          }

          var params = parseSignatureParams(entry.signature);
          activeParam = Math.min(activeParam, Math.max(0, params.length - 1));

          return {
            value: {
              signatures: [{
                label: entry.signature,
                documentation: { value: entry.documentation || '' },
                parameters: params.map(function (p) {
                  return { label: p };
                })
              }],
              activeSignature: 0,
              activeParameter: activeParam
            },
            dispose: function () {}
          };
        }
      });
    }
  };
})();
