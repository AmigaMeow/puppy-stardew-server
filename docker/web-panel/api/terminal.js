/**
 * Terminal API - Interactive terminal via WebSocket
 * Connects to SMAPI stdin/stdout for Steam Guard code input
 */

const { spawn } = require('child_process');
const { execSync } = require('child_process');
const config = require('../server');

// Only allow one terminal session at a time
let activeTerminal = null;
let activeWs = null;
let idleTimeout = null;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function resetIdleTimeout() {
  if (idleTimeout) clearTimeout(idleTimeout);
  idleTimeout = setTimeout(() => {
    if (activeWs && activeWs.readyState === 1) {
      activeWs.send(JSON.stringify({
        type: 'terminal:output',
        data: '\r\n[System] Terminal closed due to inactivity (5 min timeout)\r\n',
      }));
    }
    closeTerminal();
  }, IDLE_TIMEOUT);
}

function closeTerminal() {
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = null;
  }
  if (activeTerminal) {
    try { activeTerminal.kill(); } catch (e) {}
    activeTerminal = null;
  }
  if (activeWs) {
    activeWs._terminalProc = null;
    activeWs = null;
  }
}

function openTerminal(ws) {
  // Only one terminal at a time
  if (activeTerminal && activeWs && activeWs !== ws) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      data: 'Another terminal session is active. Only one terminal allowed at a time.',
    }));
    return;
  }

  // Close existing
  closeTerminal();

  try {
    // Find SMAPI process PID to connect to its stdin/stdout
    // We use a helper approach: tail the SMAPI log for output,
    // and write to a named pipe or directly to process stdin for input

    // Method: Use docker's internal process - write to /proc/PID/fd/0
    let smapiPid;
    try {
      smapiPid = execSync('pgrep -f StardewModdingAPI', { encoding: 'utf-8' }).trim().split('\n')[0];
    } catch (e) {
      ws.send(JSON.stringify({
        type: 'terminal:error',
        data: 'SMAPI process not found. Game may not be running yet.',
      }));
      return;
    }

    // Start tailing the SMAPI log for output
    const logPath = config.SMAPI_LOG;
    const tail = spawn('tail', ['-f', '-n', '30', logPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeTerminal = tail;
    activeWs = ws;
    ws._terminalProc = tail;
    ws._smapiPid = smapiPid;

    tail.stdout.on('data', (data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'terminal:output',
          data: data.toString(),
        }));
      }
    });

    tail.stderr.on('data', (data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'terminal:output',
          data: data.toString(),
        }));
      }
    });

    tail.on('close', () => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'terminal:closed',
          data: 'Terminal session ended.',
        }));
      }
      closeTerminal();
    });

    ws.send(JSON.stringify({
      type: 'terminal:opened',
      data: `Connected to SMAPI (PID: ${smapiPid}). This is not a Linux shell; type SMAPI commands or Steam Guard codes below.\r\n`,
    }));

    resetIdleTimeout();

  } catch (e) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      data: `Failed to open terminal: ${config.sanitizeErrorMessage(e.message)}`,
    }));
  }
}

function handleInput(ws, data) {
  if (!ws._smapiPid) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      data: 'No active terminal session. Open terminal first.',
    }));
    return;
  }

  resetIdleTimeout();

  try {
    // Write to SMAPI process stdin via /proc/PID/fd/0
    const { writeFileSync } = require('fs');
    const input = data.endsWith('\n') ? data : data + '\n';
    writeFileSync(`/proc/${ws._smapiPid}/fd/0`, input);

    // Echo back the input
    ws.send(JSON.stringify({
      type: 'terminal:output',
      data: `> ${data}\r\n`,
    }));
  } catch (e) {
    ws.send(JSON.stringify({
      type: 'terminal:error',
      data: `Failed to send input: ${config.sanitizeErrorMessage(e.message)}`,
    }));
  }
}

module.exports = { openTerminal, handleInput, closeTerminal };
