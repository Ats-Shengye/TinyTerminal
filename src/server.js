/**
 * Location   : src/server.js
 * Purpose    : WebSocket and HTTP server for TinyTerminal
 * Why        : Coordinate PTY subprocess, WebSocket communication, and static file serving
 * Related    : tests/server.test.js, public/client.js
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import pty from 'node-pty';
import {
  MAX_INPUT_LENGTH,
  DEFAULT_PORT,
  MIN_PORT,
  MAX_PORT,
  MAX_CONNECTIONS,
  SAFE_ENV_KEYS,
} from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port validation
const rawPort = process.env.PORT || DEFAULT_PORT;
const PORT = validatePort(rawPort);

// Track active connections
let activeConnections = 0;

/**
 * Log with timestamp
 * Security: Sanitizes message to prevent log injection
 * @param {string} message - Log message
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const sanitized = sanitizeLogMessage(message);
  console.log(`[${timestamp}] ${sanitized}`);
}

/**
 * Validate PORT environment variable
 * @param {string|number} port - Port number to validate
 * @returns {number} Validated port number
 * @throws {Error} If port is invalid
 */
export function validatePort(port) {
  const num = Number(port);
  if (Number.isNaN(num) || num < MIN_PORT || num > MAX_PORT) {
    throw new Error(`Invalid PORT: must be between ${MIN_PORT} and ${MAX_PORT}`);
  }
  return num;
}

/**
 * Validate BIND_ADDRESS environment variable
 * @param {string} address - Bind address to validate
 * @returns {string} Validated address
 * @throws {Error} If address is invalid
 */
export function validateBindAddress(address) {
  const allowedAddresses = ['127.0.0.1', '0.0.0.0', '::1', '::'];
  if (!allowedAddresses.includes(address)) {
    throw new Error(
      `Invalid BIND_ADDRESS: must be one of ${allowedAddresses.join(', ')}`
    );
  }
  return address;
}

/**
 * Validate user input at trust boundary
 * @param {string} input - User input text
 * @throws {Error} If input is invalid
 */
export function validateInput(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Input cannot be empty');
  }

  if (input.length > MAX_INPUT_LENGTH) {
    throw new Error('Input exceeds maximum length');
  }

  if (input.includes('\x00')) {
    throw new Error('Invalid input: contains null bytes');
  }
}

/**
 * Create HTTP server for static file serving
 */
export function createHttpServer() {
  return http.createServer(async (req, res) => {
    try {
      let filePath;

      if (req.url === '/' || req.url === '/index.html') {
        filePath = path.join(__dirname, '../public/index.html');
      } else if (req.url === '/style.css') {
        filePath = path.join(__dirname, '../public/style.css');
      } else if (req.url === '/client.js') {
        filePath = path.join(__dirname, '../public/client.js');
      } else {
        // Security headers
        res.writeHead(404, {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        });
        res.end('Not Found');
        return;
      }

      // Security: Validate path is within public directory
      const publicDir = path.join(__dirname, '../public');
      const resolvedPath = path.resolve(filePath);
      /* v8 ignore next 7 */
      if (!resolvedPath.startsWith(publicDir)) {
        res.writeHead(403, {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end('Forbidden');
        return;
      }

      const content = await fs.readFile(filePath, 'utf-8');

      const ext = path.extname(filePath);
      const contentType =
        {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
        }[ext] || 'text/plain';

      // Security headers with CSP
      const headers = {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      };

      if (ext === '.html') {
        // Allow xterm.js from CDN, WebSocket connections
        headers['Content-Security-Policy'] =
          "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' ws: wss:;";
      }

      res.writeHead(200, headers);
      res.end(content);
    } catch (err) {
      /* v8 ignore next 16 */
      if (err.code === 'ENOENT') {
        res.writeHead(404, {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        });
        res.end('Not Found');
      } else {
        log(`Server error: ${err.message}`);
        res.writeHead(500, {
          'Content-Type': 'text/plain',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end('Internal Server Error');
      }
    }
  });
}

/**
 * Check if IP is in Tailscale CGNAT range (100.64.0.0/10)
 * @param {string} hostname - IP address to check
 * @returns {boolean} True if in Tailscale range
 */
export function isTailscaleIP(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;

  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);

  // 100.64.0.0/10 = 100.64.0.0 - 100.127.255.255
  return first === 100 && second >= 64 && second <= 127;
}

/**
 * Check if origin is allowed
 * Security: Strict hostname matching prevents substring bypass (e.g., evil-localhost.com)
 * @param {string|undefined} origin - Origin header value
 * @returns {boolean} True if origin is allowed
 */
export function isAllowedOrigin(origin) {
  // origin未設定は非ブラウザクライアント（curl, wscat等）を許可
  // WebSocketはSame-Origin PolicyがないためOriginヘッダーは任意
  // 本番環境では認証レイヤーで保護すべき
  if (!origin) return true;

  try {
    const url = new URL(origin);
    // hostname厳密一致でsubstring bypassを防止
    // Tailscale CGNAT range (100.64.0.0/10) も許可
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      isTailscaleIP(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Sanitize log message to prevent log injection
 * Security: Remove control characters and newlines
 * @param {string} message - Raw log message
 * @returns {string} Sanitized message
 */
export function sanitizeLogMessage(message) {
  // 改行・制御文字をエスケープ
  return String(message).replace(/[\r\n\t\x00-\x1F\x7F]/g, '');
}

/**
 * Timing-safe token comparison to prevent timing attacks
 * Security: Uses crypto.timingSafeEqual for constant-time comparison
 * @param {string} a - First token
 * @param {string} b - Second token
 * @returns {boolean} True if tokens match
 */
export function secureTokenCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // Ensure same length by padding shorter buffer with zeros
  // (timingSafeEqual requires equal length)
  if (bufA.length !== bufB.length) {
    // Still perform comparison to maintain constant time
    const maxLen = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.alloc(maxLen);
    const paddedB = Buffer.alloc(maxLen);
    bufA.copy(paddedA);
    bufB.copy(paddedB);
    return crypto.timingSafeEqual(paddedA, paddedB);
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Create PTY process
 * @param {number} cols - Terminal columns
 * @param {number} rows - Terminal rows
 * @param {string} shell - Optional shell override
 * @returns {object} PTY process
 */
export function createPTY(cols = 80, rows = 24, shell = null) {
  const selectedShell = shell || process.env.SHELL || '/bin/bash';

  // Build safe environment from whitelist
  const safeEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key];
    }
  }
  safeEnv.TERM = 'xterm-256color';

  return pty.spawn(selectedShell, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME,
    env: safeEnv,
  });
}

/**
 * Handle WebSocket connection
 * @param {WebSocket} ws - WebSocket connection
 * @param {http.IncomingMessage} req - HTTP request
 */
export function handleConnection(ws, req) {
  // Origin validation with strict hostname matching
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    log(`Rejected connection from unauthorized origin: ${sanitizeLogMessage(origin)}`);
    ws.close();
    return;
  }

  // Connection limit
  if (activeConnections >= MAX_CONNECTIONS) {
    log('Connection limit reached, rejecting new connection');
    ws.close();
    return;
  }

  activeConnections++;
  log(`Client connected (${activeConnections}/${MAX_CONNECTIONS})`);

  // Authentication state
  const AUTH_TOKEN = process.env.TINYTERMINAL_TOKEN;
  let authenticated = !AUTH_TOKEN; // If no token required, auto-authenticate
  let authTimeout = null;
  let ptyProcess = null;

  // Set authentication timeout (5 seconds)
  if (AUTH_TOKEN) {
    authTimeout = setTimeout(() => {
      if (!authenticated) {
        log('Authentication timeout, closing connection');
        ws.close(4001, 'Authentication timeout');
      }
    }, 5000);
  }

  /**
   * Setup PTY process after authentication and initial resize
   * Security: PTY is only created after authentication to prevent leaking shell output
   * @param {number} cols - Terminal columns from client resize
   * @param {number} rows - Terminal rows from client resize
   */
  function setupPTY(cols = 80, rows = 24) {
    ptyProcess = createPTY(cols, rows);

    // Forward PTY output to WebSocket
    ptyProcess.onData((data) => {
      try {
        ws.send(
          JSON.stringify({
            type: 'output',
            data,
          })
        );
      } catch (err) {
        log(`Error sending PTY output: ${err.message}`);
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      log(`PTY exited with code ${exitCode}, signal ${signal}`);
      try {
        ws.send(
          JSON.stringify({
            type: 'exit',
            code: exitCode,
          })
        );
      } catch (err) {
        log(`Error sending PTY exit notification: ${err.message}`);
      }
    });
  }

  // PTY is created on first resize message (after authentication if required)
  // This ensures PTY starts with correct terminal dimensions from the client

  // Handle WebSocket messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Handle authentication message (must be first if token required)
      if (message.type === 'auth') {
        if (!AUTH_TOKEN) {
          // No token required, ignore auth message
          return;
        }

        if (authenticated) {
          // Already authenticated, ignore
          return;
        }

        const clientToken = message.token;
        if (secureTokenCompare(clientToken, AUTH_TOKEN)) {
          authenticated = true;
          clearTimeout(authTimeout);
          log('Client authenticated successfully');

          // PTY will be created on first resize message
          ws.send(
            JSON.stringify({
              type: 'connected',
              message: 'Authentication successful',
            })
          );
        } else {
          log('Rejected connection: invalid token');
          ws.close(4001, 'Unauthorized');
        }
        return;
      }

      // For all other message types, require authentication first
      if (!authenticated) {
        // Ignore messages before authentication
        return;
      }

      if (message.type === 'input') {
        // Validate and send user input to PTY
        validateInput(message.data);
        if (ptyProcess) {
          ptyProcess.write(message.data);
        }
      } else if (message.type === 'resize') {
        // Resize PTY with validation
        const cols = Number(message.cols);
        const rows = Number(message.rows);
        if (
          !Number.isInteger(cols) ||
          !Number.isInteger(rows) ||
          cols < 1 ||
          cols > 500 ||
          rows < 1 ||
          rows > 200
        ) {
          throw new Error('Invalid resize dimensions');
        }
        if (!ptyProcess) {
          // First resize: create PTY with correct dimensions
          setupPTY(cols, rows);
          log(`PTY created with ${cols}x${rows}`);
        } else {
          ptyProcess.resize(cols, rows);
          log(`PTY resized to ${cols}x${rows}`);
        }
      } else {
        throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (err) {
      log(`Message handling error: ${err.message}`);
      // Generic error message, do not expose err.message directly
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'Failed to process request',
        })
      );
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    if (authTimeout) {
      clearTimeout(authTimeout);
    }
    activeConnections--;
    log(`Client disconnected (${activeConnections}/${MAX_CONNECTIONS})`);
    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  });

  // Handle WebSocket error
  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`);
  });

  // Send initial connection success message (only if no auth required)
  if (!AUTH_TOKEN) {
    ws.send(
      JSON.stringify({
        type: 'connected',
        message: 'PTY initialized',
      })
    );
  }
}

/**
 * Start server
 */
export function startServer() {
  const httpServer = createHttpServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', handleConnection);

  const rawBindAddress = process.env.BIND_ADDRESS || '127.0.0.1';
  const BIND_ADDRESS = validateBindAddress(rawBindAddress);

  httpServer.listen(PORT, BIND_ADDRESS, () => {
    log(`Server running at http://${BIND_ADDRESS}:${PORT}`);
    log(`WebSocket available at ws://${BIND_ADDRESS}:${PORT}`);
  });

  return { httpServer, wss };
}

// Start server if run directly
/* v8 ignore next 3 */
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer();
}
