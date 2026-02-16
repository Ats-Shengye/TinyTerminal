/**
 * Location   : src/constants.js
 * Purpose    : Shared constants across the application
 * Why        : Avoid duplication of magic numbers and configuration values
 * Related    : src/server.js, tests/constants.test.js
 */

// Input validation
export const MAX_INPUT_LENGTH = 10000;

// Server configuration
export const DEFAULT_PORT = 49000;
export const MIN_PORT = 1024;
export const MAX_PORT = 49151;

// WebSocket limits
export const MAX_CONNECTIONS = 2;

// PTY environment whitelist
export const SAFE_ENV_KEYS = [
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'PATH',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'COLORTERM',
];
