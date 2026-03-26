import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface Props {
  sessionId: string;
  isVisible?: boolean;
  isFocused?: boolean;
  onPathChange?: (path: string) => void;
}

export default function SSHTerminal({ sessionId, isVisible = true, isFocused = false, onPathChange }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isClosedRef = useRef(false);

  const isVisibleRef = useRef(isVisible);
  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    if (isFocused && xtermRef.current) {
      xtermRef.current.focus();
    }
  }, [isFocused]);

  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      // Small delay to ensure DOM is updated and has dimensions
      setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          xtermRef.current.focus();
          invoke('resize_ssh_session', { 
            sessionId, 
            rows: xtermRef.current.rows, 
            cols: xtermRef.current.cols 
          });
        }
      }, 50);
    }
  }, [isVisible, sessionId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      theme: {
        background: 'transparent',
        foreground: '#e4e4e7',
        cursor: '#3b82f6',
        selectionBackground: 'rgba(59, 130, 246, 0.3)',
        black: '#000000',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#d4d4d8',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Shell Integration: OSC handlers for path changes
    const handlePath = (rawPath: string) => {
      let path = rawPath.replace(/[\r\n]+$/, '').trim();
      if (path.startsWith('file://')) {
        // Handle file://[hostname]/path or file:///path
        const match = path.match(/^file:\/\/[^\/]*(.*)$/);
        if (match) path = decodeURIComponent(match[1]);
      }
      if (path && path.startsWith('/')) {
        onPathChange?.(path);
      }
    };

    // OSC 7: CWD (Standard)
    term.parser.registerOscHandler(7, (data) => {
      // Some shells send hostname;file://...
      const parts = data.split(';');
      handlePath(parts.length > 1 ? parts[1] : parts[0]);
      return true;
    });

    // OSC 133: Shell Integration (VSCode / FinalTerm)
    term.parser.registerOscHandler(133, (data) => {
      if (data.startsWith('P;Cwd=')) {
        handlePath(data.substring(6));
      }
      return true;
    });

    // OSC 1337: iTerm2
    term.parser.registerOscHandler(1337, (data) => {
      if (data.startsWith('CurrentDir=')) {
        handlePath(data.substring(11));
      }
      return true;
    });

    // Fallback: Watch for title changes (e.g., user@host: /path)
    term.onTitleChange((title) => {
      const match = title.match(/.*: (.*)/);
      if (match && match[1].startsWith('/')) {
        handlePath(match[1]);
      }
    });

    // Use ResizeObserver for more reliable sizing
    const resizeObserver = new ResizeObserver(() => {
      if (isVisibleRef.current) {
        fitAddon.fit();
      }
    });
    resizeObserver.observe(terminalRef.current);

    const startSession = async () => {
      isClosedRef.current = false;
      try {
        await invoke('start_ssh_session', { 
          sessionId, 
          rows: term.rows, 
          cols: term.cols 
        });
      } catch (err) {
        term.write(`\r\n\x1b[31mError: ${err}\x1b[0m\r\n`);
        isClosedRef.current = true;
        term.write('\x1b[33mPress "r" to retry connection.\x1b[0m\r\n');
      }
    };

    // Initial fit after a short delay to ensure container is fully laid out
    const initialFitTimeout = setTimeout(() => {
      fitAddon.fit();
      startSession();
    }, 50);

    // Handlers
    const unlistenData = listen<string>(`ssh_data_${sessionId}`, (event) => {
      term.write(event.payload);
    });

    const unlistenClosed = listen<void>(`ssh_closed_${sessionId}`, () => {
      isClosedRef.current = true;
      term.write('\r\n\x1b[31mConnection closed. Press "r" to reconnect.\x1b[0m\r\n');
    });

    term.onData((data) => {
      if (isClosedRef.current) {
        if (data.toLowerCase() === 'r') {
          term.write('\r\n\x1b[34mReconnecting...\x1b[0m\r\n');
          startSession();
        }
        return;
      }
      invoke('send_ssh_data', { sessionId, data });
    });

    term.onResize((size) => {
      invoke('resize_ssh_session', { 
        sessionId, 
        rows: size.rows, 
        cols: size.cols 
      });
    });

    return () => {
      resizeObserver.disconnect();
      clearTimeout(initialFitTimeout);
      unlistenData.then(f => f());
      unlistenClosed.then(f => f());
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div 
      ref={terminalRef} 
      className="w-full h-full bg-transparent"
    />
  );
}
