import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface Props {
  sessionId: string;
  isVisible?: boolean;
}

export default function SSHTerminal({ sessionId, isVisible = true }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      // Small delay to ensure DOM is updated and has dimensions
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (xtermRef.current) {
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
    
    // Small delay to ensure container is rendered
    setTimeout(() => {
      fitAddon.fit();
    }, 10);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Start SSH session
    const startSession = async () => {
      try {
        await invoke('start_ssh_session', { 
          sessionId, 
          rows: term.rows, 
          cols: term.cols 
        });
      } catch (err) {
        term.write(`\r\n\x1b[31mError: ${err}\x1b[0m\r\n`);
      }
    };

    startSession();

    // Handlers
    const unlistenData = listen<string>(`ssh_data_${sessionId}`, (event) => {
      term.write(event.payload);
    });

    const unlistenClosed = listen<void>(`ssh_closed_${sessionId}`, () => {
      term.write('\r\n\x1b[31mConnection closed.\x1b[0m\r\n');
    });

    term.onData((data) => {
      invoke('send_ssh_data', { sessionId, data });
    });

    const handleResize = () => {
      fitAddon.fit();
      invoke('resize_ssh_session', { 
        sessionId, 
        rows: term.rows, 
        cols: term.cols 
      });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
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
