// --- Types ---
export interface SessionInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  key_path?: string;
  jump_host?: string;
  group: string;
  status: 'Idle' | 'Running' | 'Success' | 'Failure';
  history: string[];
}

export interface ScriptVar {
  name: string;
  required: boolean;
  default_value: string;
}

export interface Script {
  id: string;
  name: string;
  command_template: string;
  vars: ScriptVar[];
}

export type Page = 'single' | 'multi' | 'settings';

export interface Tab {
  id: string;
  sessionId: string | null;
  instanceId: string | null;
}
