/**
 * Location   : tests/client.test.js
 * Purpose    : Test client-side logic (xterm input control, special keys, expanded mode)
 * Why        : Ensure UI behavior matches specification
 * Related    : public/client.js
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dom;
let window;
let document;
let mockTerminal;
let mockFitAddon;
let mockWebSocket;
// Setup DOM and global mocks before each test
function setupDOM() {
  const html = readFileSync(
    path.join(__dirname, '../public/index.html'),
    'utf-8'
  );

  // Create jsdom instance
  dom = new JSDOM(html, {
    url: 'http://localhost:3000',
    runScripts: 'dangerously',
  });

  window = dom.window;
  document = window.document;

  // Mock xterm.js Terminal
  mockTerminal = {
    open: vi.fn(),
    write: vi.fn(),
    loadAddon: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    onData: vi.fn(),
    scrollLines: vi.fn(),
    cols: 80,
    rows: 24,
  };

  // Mock FitAddon
  mockFitAddon = {
    fit: vi.fn(),
  };

  // Mock xterm.js globals in jsdom window
  window.Terminal = function() { return mockTerminal; };
  window.FitAddon = {
    FitAddon: function() { return mockFitAddon; },
  };

  // Mock WebSocket
  mockWebSocket = {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    OPEN: 1,
  };

  window.WebSocket = function() { return mockWebSocket; };
  window.WebSocket.OPEN = 1;

  // Mock console methods to suppress client.js logs
  window.console = {
    log: vi.fn(),
    error: vi.fn(),
  };

  // Mock setTimeout to execute synchronously in tests
  window.setTimeout = (fn) => fn();
}

// Execute client.js in the jsdom context
function executeClientJS() {
  const clientJS = readFileSync(
    path.join(__dirname, '../public/client.js'),
    'utf-8'
  );

  // Use jsdom's window.eval to execute in browser-like context
  window.eval(clientJS);
}

describe('xterm.js Input Control', () => {
  beforeEach(() => {
    setupDOM();
    executeClientJS();
  });

  it('should not register custom key event handler (all input goes through xterm.js)', () => {
    expect(mockTerminal.attachCustomKeyEventHandler).not.toHaveBeenCalled();
  });
});

describe('Special Key Bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    executeClientJS();
    // Trigger WebSocket onopen to set connection state
    if (mockWebSocket.onopen) mockWebSocket.onopen();
  });

  it('should send \\x1b when Esc button is tapped', () => {
    const escBtn = document.querySelector('[data-key="esc"]');
    escBtn.click();

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\x1b' })
    );
  });

  it('should toggle Ctrl modifier on tap', () => {
    const ctrlBtn = document.querySelector('[data-key="ctrl"]');

    expect(ctrlBtn.classList.contains('active')).toBe(false);

    ctrlBtn.click();
    expect(ctrlBtn.classList.contains('active')).toBe(true);

    ctrlBtn.click();
    expect(ctrlBtn.classList.contains('active')).toBe(false);
  });

  it('should send \\x03 when Ctrl is active and C is typed in textarea', () => {
    const ctrlBtn = document.querySelector('[data-key="ctrl"]');
    const textarea = document.getElementById('input-textarea');

    // Activate Ctrl
    ctrlBtn.click();
    expect(ctrlBtn.classList.contains('active')).toBe(true);

    // Type 'c' in textarea
    const keydownEvent = new window.KeyboardEvent('keydown', {
      key: 'c',
      bubbles: true,
      cancelable: true,
    });

    textarea.dispatchEvent(keydownEvent);

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\x03' })
    );
  });

  it('should auto-disable Ctrl after sending modified key', () => {
    const ctrlBtn = document.querySelector('[data-key="ctrl"]');
    const textarea = document.getElementById('input-textarea');

    ctrlBtn.click();
    expect(ctrlBtn.classList.contains('active')).toBe(true);

    const keydownEvent = new window.KeyboardEvent('keydown', {
      key: 'c',
      bubbles: true,
      cancelable: true,
    });

    textarea.dispatchEvent(keydownEvent);

    expect(ctrlBtn.classList.contains('active')).toBe(false);
  });

  it('should highlight Ctrl button when active', () => {
    const ctrlBtn = document.querySelector('[data-key="ctrl"]');

    expect(ctrlBtn.classList.contains('active')).toBe(false);
    ctrlBtn.click();
    expect(ctrlBtn.classList.contains('active')).toBe(true);
  });

  it('should send \\t when Tab button is tapped', () => {
    const tabBtn = document.querySelector('[data-key="tab"]');
    tabBtn.click();

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\t' })
    );
  });

  it('should send arrow key ANSI sequences when arrow buttons are tapped', () => {
    const upBtn = document.querySelector('[data-key="arrow-up"]');
    const downBtn = document.querySelector('[data-key="arrow-down"]');
    const leftBtn = document.querySelector('[data-key="arrow-left"]');
    const rightBtn = document.querySelector('[data-key="arrow-right"]');

    upBtn.click();
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\x1b[A' })
    );

    downBtn.click();
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\x1b[B' })
    );

    leftBtn.click();
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\x1b[D' })
    );

    rightBtn.click();
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '\x1b[C' })
    );
  });

  it('should send / character when / button is tapped', () => {
    const slashBtn = document.querySelector('[data-key="slash"]');
    slashBtn.click();

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '/' })
    );
  });

  it('should send - character when - button is tapped', () => {
    const minusBtn = document.querySelector('[data-key="minus"]');
    minusBtn.click();

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: '-' })
    );
  });
});

describe('Expanded Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    executeClientJS();
    if (mockWebSocket.onopen) mockWebSocket.onopen();
  });

  it('should preserve textarea text when switching to expanded mode', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const expandedTextarea = document.getElementById('expanded-textarea');
    const expandBtn = document.getElementById('expand-btn');

    inputTextarea.value = 'test text';
    expandBtn.click();

    expect(expandedTextarea.value).toBe('test text');
  });

  it('should preserve textarea text when switching back to normal mode', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const expandedTextarea = document.getElementById('expanded-textarea');
    const expandBtn = document.getElementById('expand-btn');
    const collapseBtn = document.getElementById('collapse-btn');

    inputTextarea.value = 'test text';
    expandBtn.click();

    expandedTextarea.value = 'modified text';
    collapseBtn.click();

    expect(inputTextarea.value).toBe('modified text');
  });

  it('should clear textarea and return to normal mode after sending', () => {
    const expandedTextarea = document.getElementById('expanded-textarea');
    const expandedMode = document.getElementById('expanded-mode');
    const expandBtn = document.getElementById('expand-btn');
    const sendExpandedBtn = document.getElementById('send-expanded-btn');

    expandBtn.click();
    expandedTextarea.value = 'send this';
    sendExpandedBtn.click();

    expect(expandedTextarea.value).toBe('');
    expect(expandedMode.style.display).toBe('none');
  });

  it('should show character count in expanded mode header', () => {
    const expandedTextarea = document.getElementById('expanded-textarea');
    const charCount = document.getElementById('char-count');
    const expandBtn = document.getElementById('expand-btn');

    expandBtn.click();
    expandedTextarea.value = 'hello';
    expandedTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(charCount.textContent).toBe('5 chars');
  });

  it('should remove row limit in expanded mode', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const expandedTextarea = document.getElementById('expanded-textarea');

    // Normal mode has max 4 rows
    expect(inputTextarea.rows).toBe(1);

    // Expanded mode has no row limit (style-based, not rows attribute)
    // Check that expanded textarea exists and can grow
    expect(expandedTextarea).toBeTruthy();
    expect(expandedTextarea.style.maxHeight || '').not.toBe('160px');
  });
});

describe('WebSocket Communication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    executeClientJS();
    if (mockWebSocket.onopen) mockWebSocket.onopen();
  });

  it('should send input message when textarea is submitted', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const sendBtn = document.getElementById('send-btn');

    inputTextarea.value = 'echo test\n';
    sendBtn.click();

    // 末尾の改行はトリムされる（ソフトキーボード対策）
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'echo test\r' })
    );
  });

  it('should send resize message when terminal is resized', () => {
    // Trigger resize
    window.dispatchEvent(new window.Event('resize'));

    // Wait for the resize handler to process
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"type":"resize"')
    );
  });

  it('should write output messages to xterm terminal', () => {
    const outputMessage = {
      type: 'output',
      data: 'hello from PTY\r\n',
    };

    const messageEvent = {
      data: JSON.stringify(outputMessage),
    };

    mockWebSocket.onmessage(messageEvent);

    expect(mockTerminal.write).toHaveBeenCalledWith('hello from PTY\r\n');
  });

  it('should handle connection errors gracefully', () => {
    const consoleErrorSpy = vi.spyOn(window.console, 'error');

    const errorEvent = new Error('Connection failed');
    mockWebSocket.onerror(errorEvent);

    expect(consoleErrorSpy).toHaveBeenCalledWith('WebSocket error:', errorEvent);
  });

  it('should reconnect immediately when page becomes visible again (bug fix)', () => {
    // 一旦クリーンな状態でテストを開始するため、新しいDOMをセットアップ
    vi.clearAllMocks();
    setupDOM();

    // WebSocket生成を監視するためのスパイを設定
    let wsCreationCount = 0;
    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(...args) {
      wsCreationCount++;
      const instance = originalWebSocket.apply(this, args);
      return instance;
    };
    window.WebSocket.OPEN = 1;

    // client.jsを実行（初回接続）
    executeClientJS();
    const initialWsCount = wsCreationCount;

    // WebSocketを切断状態にシミュレート
    mockWebSocket.readyState = 3; // CLOSED
    if (mockWebSocket.onclose) mockWebSocket.onclose();

    // ページが表示状態に戻ったとシミュレート
    Object.defineProperty(document, 'hidden', {
      writable: true,
      configurable: true,
      value: false,
    });

    document.dispatchEvent(new window.Event('visibilitychange'));

    // WebSocketが再生成されたことを確認（visibilitychangeによる即座の再接続）
    expect(wsCreationCount).toBeGreaterThan(initialWsCount);
  });
});

describe('Textarea Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDOM();
    executeClientJS();
    if (mockWebSocket.onopen) mockWebSocket.onopen();
  });

  it('should auto-expand up to 4 rows', () => {
    const inputTextarea = document.getElementById('input-textarea');

    // Simulate multiline input
    inputTextarea.value = 'line1\nline2\nline3\nline4';
    inputTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));

    // Max height is 160px (4 rows * ~40px)
    const computedHeight = parseInt(inputTextarea.style.height, 10);
    expect(computedHeight).toBeLessThanOrEqual(160);
  });

  it('should use internal scroll beyond 4 rows', () => {
    const inputTextarea = document.getElementById('input-textarea');

    // Simulate very tall content
    Object.defineProperty(inputTextarea, 'scrollHeight', {
      value: 200,
      configurable: true,
    });

    inputTextarea.value = 'line1\nline2\nline3\nline4\nline5\nline6';
    inputTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));

    // Height should be capped at 160px
    const computedHeight = parseInt(inputTextarea.style.height, 10);
    expect(computedHeight).toBe(160);
  });

  it('should send input on Enter key (not Shift)', () => {
    const inputTextarea = document.getElementById('input-textarea');

    inputTextarea.value = 'send this';

    const enterEvent = new window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    inputTextarea.dispatchEvent(enterEvent);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'send this\r' })
    );
    expect(inputTextarea.value).toBe('');
  });

  it('should insert newline on Shift+Enter', () => {
    const inputTextarea = document.getElementById('input-textarea');

    inputTextarea.value = 'line1';

    const shiftEnterEvent = new window.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    inputTextarea.dispatchEvent(shiftEnterEvent);

    // Shift+Enter should allow default behavior (newline insertion)
    expect(shiftEnterEvent.defaultPrevented).toBe(false);
  });

  it('should send input on send button click', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const sendBtn = document.getElementById('send-btn');

    inputTextarea.value = 'button send\n';
    sendBtn.click();

    // 末尾の改行はトリムされる（ソフトキーボード対策）
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'button send\r' })
    );
    expect(inputTextarea.value).toBe('');
  });

  it('should trim trailing newlines from textarea before sending (soft keyboard fix)', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const sendBtn = document.getElementById('send-btn');

    inputTextarea.value = 'hello\n\n\n';
    sendBtn.click();

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'hello\r' })
    );
  });

  it('should preserve mid-text newlines when trimming trailing ones', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const sendBtn = document.getElementById('send-btn');

    inputTextarea.value = 'line1\nline2\n';
    sendBtn.click();

    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'line1\nline2\r' })
    );
  });

  it('should handle beforeinput insertLineBreak by sending (soft keyboard Enter)', () => {
    const inputTextarea = document.getElementById('input-textarea');
    inputTextarea.value = 'test cmd';

    const beforeInputEvent = new window.InputEvent('beforeinput', {
      inputType: 'insertLineBreak',
      bubbles: true,
      cancelable: true,
    });

    inputTextarea.dispatchEvent(beforeInputEvent);

    expect(beforeInputEvent.defaultPrevented).toBe(true);
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'test cmd\r' })
    );
  });

  it('should not send duplicate input when xterm.onData fires during textarea submit (bug fix)', () => {
    const inputTextarea = document.getElementById('input-textarea');
    const sendBtn = document.getElementById('send-btn');

    // Mock onData callback を取得（clearAllMocksの前に取得）
    const onDataCallback = mockTerminal.onData.mock.calls[0][0];

    // テスト用にWebSocket.sendのカウントをリセット
    mockWebSocket.send.mockClear();

    inputTextarea.value = 'test';

    // sendBtn.clickを呼ぶと、handleTextareaSubmitが実行され、
    // その中でsetTimeout(..., 0)が呼ばれる。
    // JSDOMのsetTimeoutは同期的に実行されるのでフラグが即座にオフになる。
    // よって、onDataCallback呼び出しのタイミングをsendBtn.clickの直後にする必要がある。

    // フラグがオンの間にonDataCallbackが呼ばれることをシミュレート
    let onDataCalledDuringSubmit = false;
    const originalSend = mockWebSocket.send.getMockImplementation();
    mockWebSocket.send = vi.fn((...args) => {
      // send呼び出し直後にonDataを呼ぶ（同期的）
      if (!onDataCalledDuringSubmit) {
        onDataCalledDuringSubmit = true;
        onDataCallback('\x1b[O'); // ソフトキーボードのEnterから来る余分な入力
      }
      if (originalSend) return originalSend(...args);
    });

    sendBtn.click();

    // sendが1回だけ呼ばれていることを確認（'test\r'のみ、'\x1b[O'は送られない）
    expect(mockWebSocket.send).toHaveBeenCalledTimes(1);
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'input', data: 'test\r' })
    );
  });
});
