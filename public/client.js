/**
 * Location   : public/client.js
 * Purpose    : Client-side logic for TinyTerminal
 * Why        : Handle xterm.js, WebSocket, input control, and special keys
 * Related    : public/index.html, src/server.js
 */

// Initialize xterm.js
const terminal = new Terminal({
  scrollback: 5000,
  cursorBlink: true,
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  theme: {
    background: '#0c0c14',
    foreground: '#e0e0e0',
    cursor: '#4ade80',
    cursorAccent: '#0c0c14',
    selectionBackground: '#3a3a44',
    black: '#1a1a24',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e0e0e0',
    brightBlack: '#3a3a44',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fcd34d',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#f5f5f5',
  },
});

// Fit addon for responsive sizing
const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);

// Mount terminal to DOM
const terminalContainer = document.getElementById('terminal-container');
terminal.open(terminalContainer);
fitAddon.fit();

// WebSocket connection
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isReconnecting = false; // バックグラウンド復帰時の重複接続防止

// textarea送信中フラグ（二重エンター問題対策）
let isTextareaSending = false;

// Modifier key state for special key bar
const modifierState = {
  ctrl: false,
  alt: false,
  shift: false,
};

// DOM elements
const statusIndicator = document.getElementById('status-indicator');
const statusHost = document.getElementById('status-host');
const inputTextarea = document.getElementById('input-textarea');
const sendBtn = document.getElementById('send-btn');
const expandBtn = document.getElementById('expand-btn');
const expandedMode = document.getElementById('expanded-mode');
const expandedTextarea = document.getElementById('expanded-textarea');
const collapseBtn = document.getElementById('collapse-btn');
const sendExpandedBtn = document.getElementById('send-expanded-btn');
const charCount = document.getElementById('char-count');

/**
 * Update connection status UI
 * @param {boolean} connected - Connection state
 */
function updateStatus(connected) {
  if (connected) {
    statusIndicator.className = 'status-connected';
    statusHost.textContent = `${window.location.hostname}`;
  } else {
    statusIndicator.className = 'status-disconnected';
    statusHost.textContent = 'disconnected';
  }
}

/**
 * Connect to WebSocket server
 */
function connect() {
  // 既に接続中または再接続待機中の場合はスキップ
  if (isReconnecting) {
    return;
  }
  isReconnecting = true;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    updateStatus(true);
    reconnectAttempts = 0;
    isReconnecting = false;

    // Send authentication message if token is present in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
      ws.send(
        JSON.stringify({
          type: 'auth',
          token: token,
        })
      );

      // Security: Remove token from URL to prevent it from staying in browser history
      const cleanUrl = new URL(window.location);
      cleanUrl.searchParams.delete('token');
      window.history.replaceState({}, '', cleanUrl);
    }

    // Send initial resize immediately on connection
    handleResize();
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      if (message.type === 'output') {
        // Write PTY output to terminal
        terminal.write(message.data);
      } else if (message.type === 'connected') {
        console.log('PTY initialized');
      } else if (message.type === 'exit') {
        console.log(`PTY exited with code ${message.code}`);
        terminal.write('\r\n[Process exited]\r\n');
      } else if (message.type === 'error') {
        console.error('Server error:', message.message);
        terminal.write(`\r\n[Error: ${message.message}]\r\n`);
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    updateStatus(false);
    isReconnecting = false;

    // Attempt reconnection
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
      console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(connect, delay);
    } else {
      terminal.write('\r\n[Connection lost. Reload page to reconnect]\r\n');
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

/**
 * Send input to server
 * @param {string} text - Input text
 */
function sendInput(text) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }

  ws.send(
    JSON.stringify({
      type: 'input',
      data: text,
    })
  );
}

/**
 * Send resize event to server
 * @param {number} cols - Terminal columns
 * @param {number} rows - Terminal rows
 */
function sendResize(cols, rows) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(
    JSON.stringify({
      type: 'resize',
      cols,
      rows,
    })
  );
}

// Forward xterm.js keyboard input directly to PTY
// Tapping the terminal area on mobile opens software keyboard for direct input
terminal.onData((data) => {
  // textarea送信中は転送をスキップ（二重エンター問題対策）
  if (isTextareaSending) {
    return;
  }
  // Focus In/Out シーケンスをフィルタ（スマホでフォーカス移動が頻発するため）
  if (data === '\x1b[I' || data === '\x1b[O') {
    return;
  }
  sendInput(data);
});

/**
 * Clear all modifier states
 */
function clearModifiers() {
  modifierState.ctrl = false;
  modifierState.alt = false;
  modifierState.shift = false;
  document.querySelectorAll('.modifier-btn').forEach((btn) => {
    btn.classList.remove('active');
  });
}

/**
 * Apply modifier keys to character and send to PTY
 * @param {string} char - Character to send
 */
function sendWithModifiers(char) {
  let output = char;

  if (modifierState.ctrl) {
    // Ctrl+A = \x01, Ctrl+B = \x02, ..., Ctrl+Z = \x1a
    const code = char.toUpperCase().charCodeAt(0);
    if (code >= 65 && code <= 90) {
      output = String.fromCharCode(code - 64);
    }
  }

  sendInput(output);
  clearModifiers();
}

// Prevent focus steal on all UI buttons (keeps soft keyboard open)
document.querySelectorAll('.key-btn, #send-btn, #expand-btn, #collapse-btn, #send-expanded-btn').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
});

// Handle special key bar clicks
document.querySelectorAll('.key-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;

    // Modifier keys (toggle state)
    if (key === 'ctrl' || key === 'alt' || key === 'shift') {
      modifierState[key] = !modifierState[key];
      btn.classList.toggle('active');
      return;
    }

    // Scroll to bottom (special action)
    if (key === 'scroll-bottom') {
      terminal.scrollToBottom();
      return;
    }

    // Normal keys (send immediately)
    const keyMap = {
      esc: '\x1b',
      tab: '\t',
      slash: '/',
      minus: '-',
      'arrow-left': '\x1b[D',
      'arrow-right': '\x1b[C',
      'arrow-up': '\x1b[A',
      'arrow-down': '\x1b[B',
    };

    if (keyMap[key]) {
      sendInput(keyMap[key]);
    }
  });
});

// Handle textarea input submission
function handleTextareaSubmit(textarea) {
  // 末尾の改行を除去（ソフトキーボードがEnterで挿入する余分な改行対策）
  const text = textarea.value.replace(/[\r\n]+$/, '');

  // textarea送信中フラグをオン（二重エンター問題対策）
  isTextareaSending = true;

  // Empty textarea: send just Enter (for TUI apps like nvim)
  if (text.length === 0) {
    sendInput('\r');
  } else {
    sendInput(text + '\r');
  }

  textarea.value = '';
  textarea.style.height = 'auto'; // Reset height

  // 送信完了後にフラグをオフ（ソフトキーボードのイベント処理完了を待つ）
  setTimeout(() => {
    isTextareaSending = false;
  }, 50);
}

// Normal mode send button
sendBtn.addEventListener('click', () => {
  handleTextareaSubmit(inputTextarea);
});

// ソフトキーボードのEnter捕捉（keydownでe.key==='Unidentified'になる端末対策）
inputTextarea.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'insertLineBreak') {
    e.preventDefault();
    handleTextareaSubmit(inputTextarea);
  }
});

// Enter to send, Shift+Enter for newline
inputTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleTextareaSubmit(inputTextarea);
    return;
  }

  // If modifiers are active, intercept and send with modifiers
  if (modifierState.ctrl || modifierState.alt || modifierState.shift) {
    if (e.key.length === 1) {
      e.preventDefault();
      sendWithModifiers(e.key);
    }
  }
});

// Auto-resize textarea (1-4 rows)
inputTextarea.addEventListener('input', () => {
  inputTextarea.style.height = 'auto';
  const newHeight = Math.min(inputTextarea.scrollHeight, 160); // Max 4 rows
  inputTextarea.style.height = `${newHeight}px`;
});

// Expand button
expandBtn.addEventListener('click', () => {
  expandedTextarea.value = inputTextarea.value;
  expandedMode.style.display = 'flex';
  updateCharCount();
  expandedTextarea.focus();
});

// Collapse button
collapseBtn.addEventListener('click', () => {
  inputTextarea.value = expandedTextarea.value;
  expandedMode.style.display = 'none';
  inputTextarea.focus();
});

// Send from expanded mode
sendExpandedBtn.addEventListener('click', () => {
  handleTextareaSubmit(expandedTextarea);
  expandedMode.style.display = 'none';
  inputTextarea.focus();
});

// Update character count in expanded mode
function updateCharCount() {
  const count = expandedTextarea.value.length;
  charCount.textContent = `${count} chars`;
}

expandedTextarea.addEventListener('input', updateCharCount);

// Handle terminal resize
// FitAddon's CSS-based cell measurement diverges from actual canvas rendering
// due to DPR subpixel rounding. Correct by computing effective cell width
// from physical pixel grid, then derive safe column count.
function handleResize() {
  fitAddon.fit();
  const containerWidth = terminalContainer.clientWidth;
  const cellW = terminal._core._renderService?.dimensions?.css?.cell?.width;
  let cols = terminal.cols;
  const rows = terminal.rows;

  if (cellW && containerWidth) {
    const dpr = window.devicePixelRatio || 1;
    const physCellWidth = Math.ceil(cellW * dpr);
    const effectiveCellWidth = physCellWidth / dpr;
    cols = Math.floor(containerWidth / effectiveCellWidth);
  }

  cols = Math.max(2, cols - 2); // Safety margin (1 fullwidth char)
  terminal.resize(cols, rows);
  sendResize(cols, rows);
  console.log(`Terminal resized to ${cols}x${rows}`);
}

window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', handleResize);

// Touch scrolling for mobile
// Document-level handler with capture to guarantee event reception
let lastTouchY = null;

document.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1 && terminalContainer.contains(e.target)) {
    lastTouchY = e.touches[0].clientY;
  }
}, { passive: false, capture: true });

document.addEventListener('touchmove', (e) => {
  if (lastTouchY === null || e.touches.length !== 1) return;
  if (!terminalContainer.contains(e.target)) return;
  const currentY = e.touches[0].clientY;
  const deltaY = lastTouchY - currentY;
  if (Math.abs(deltaY) >= 12) {
    const isAltBuffer = terminal.buffer.active.type === 'alternate';
    if (isAltBuffer) {
      // In TUI apps (nvim, etc.), send arrow keys instead of scroll
      const arrow = deltaY > 0 ? '\x1b[A' : '\x1b[B'; // Up : Down (natural scroll)
      sendInput(arrow);
      sendInput(arrow);
    } else {
      terminal.scrollLines(deltaY > 0 ? 2 : -2);
    }
    lastTouchY = currentY;
    e.preventDefault();
  }
}, { passive: false, capture: true });

document.addEventListener('touchend', () => {
  lastTouchY = null;
}, { passive: true });

// Adjust layout when soft keyboard appears/disappears
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    document.body.style.height = `${window.visualViewport.height}px`;
    handleResize();
  });
}

// Initial connection
connect();

// Fallback resize in case onopen fires before DOM is ready
setTimeout(() => {
  handleResize();
}, 500);

// バックグラウンド復帰時に即再接続（バグ2対策）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
    console.log('Page visible again, reconnecting immediately');
    reconnectAttempts = 0; // 指数バックオフをリセット
    connect();
  }
});
