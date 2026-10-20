import { TextDecoder, TextEncoder } from 'node:util';

/**
 * jsdom (via jest-environment-jsdom) does not provide the WHATWG encoding
 * globals, and react-router's development build reaches for TextEncoder at
 * import time. Node has both, so hand them to the environment before any
 * module loads.
 */
Object.assign(globalThis, { TextEncoder, TextDecoder });
