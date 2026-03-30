import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Network, Plus, Trash2, X, Edit } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';

interface PortProxyRecord {
  id: string;
  localPort: number;
  remotePort: number;
  active: boolean;
  proxyId?: string; // The ID returned by backend when started
}

interface Props {
  sessionId: string;
  instanceId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function PortProxyDrawer({ sessionId, isOpen, onClose }: Props) {
  const [records, setRecords] = useState<PortProxyRecord[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [localPort, setLocalPort] = useState<string>('');
  const [remotePort, setRemotePort] = useState<string>('');

  const drawerRef = useRef<HTMLDivElement>(null);

  // Load from localStorage specifically for this session
  useEffect(() => {
    if (isOpen && sessionId) {
      const saved = localStorage.getItem(`port_proxy_${sessionId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Set everything to inactive on initial load, because we don't persist active state across app restarts easily yet.
          setRecords(parsed.map((r: PortProxyRecord) => ({ ...r, active: false, proxyId: undefined })));
        } catch (e) { }
      }
    }
  }, [isOpen, sessionId]);

  // Save to localStorage when records change
  useEffect(() => {
    if (sessionId && records.length > 0) {
      localStorage.setItem(`port_proxy_${sessionId}`, JSON.stringify(records));
    }
  }, [records, sessionId]);

  useEffect(() => {
    // When drawer closes, we might want to keep proxies running. 
    // They are tied to the backend state and will die when the process dies. 
    // Wait, if the user closes the *tab* (instanceId), we should stop them?
    // Actually, our API takes `session_id`. Wait, `instanceId` vs `session_id`.
    // The rust backend takes `session_id`, meaning it will create a NEW ssh connection for the proxy!
  }, []);

  const handleRemotePortChange = (val: string) => {
    setRemotePort(val);
    if (!localPort || localPort === remotePort) {
      setLocalPort(val);
    }
  };

  const saveRecord = () => {
    const lP = parseInt(localPort);
    const rP = parseInt(remotePort);

    if (isNaN(lP) || isNaN(rP) || lP < 1 || rP < 1) {
      alert("请输入有效的端口号");
      return;
    }

    if (editingId) {
      // If active, we should probably stop it first before edit, but simpler to just edit inactive.
      setRecords(records.map(r => r.id === editingId ? { ...r, localPort: lP, remotePort: rP } : r));
    } else {
      setRecords([...records, {
        id: Date.now().toString(),
        localPort: lP,
        remotePort: rP,
        active: false
      }]);
    }

    setIsAdding(false);
    setEditingId(null);
    setLocalPort('');
    setRemotePort('');
  };

  const deleteRecord = async (id: string, proxyId?: string) => {
    if (proxyId) {
      try {
        await invoke('stop_port_proxy', { proxyId });
      } catch (e) { }
    }
    const next = records.filter(r => r.id !== id);
    setRecords(next);
    if (next.length === 0) {
      localStorage.removeItem(`port_proxy_${sessionId}`);
    }
  };

  const toggleProxy = async (record: PortProxyRecord) => {
    if (record.active) {
      // stop
      if (record.proxyId) {
        try {
          await invoke('stop_port_proxy', { proxyId: record.proxyId });
        } catch (e) {
          console.error("Failed to stop proxy", e);
        }
      }
      setRecords(records.map(r => r.id === record.id ? { ...r, active: false, proxyId: undefined } : r));
    } else {
      // start
      try {
        const proxyId = await invoke<string>('start_port_proxy', {
          sessionId,
          localPort: record.localPort,
          remotePort: record.remotePort
        });
        setRecords(records.map(r => r.id === record.id ? { ...r, active: true, proxyId } : r));
      } catch (e: any) {
        alert("启动代理失败: " + e);
        setRecords(records.map(r => r.id === record.id ? { ...r, active: false, proxyId: undefined } : r));
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={drawerRef}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute top-0 left-[2.5%] right-[2.5%] z-50 bg-card border-x border-b border-border shadow-2xl overflow-hidden flex flex-col max-h-[60%] rounded-b-xl"
        >
          <div className="flex items-center justify-between p-3 border-b border-border bg-muted/40 backdrop-blur-md">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Network size={16} className="text-primary" />
              <span>端口转发</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-primary/20 hover:text-primary transition-colors" onClick={() => { setIsAdding(true); setEditingId(null); setLocalPort(''); setRemotePort(''); }}>
                <Plus size={16} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full hover:bg-destructive/20 hover:text-destructive transition-colors" onClick={onClose}>
                <X size={16} />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0 relative z-10 bg-background/50">
            {records.length === 0 && !isAdding ? (
              <div className="py-8 text-center text-muted-foreground flex flex-col items-center gap-3">
                <Network size={40} className="opacity-20" />
                <p className="text-sm">暂无端口代理记录</p>
                <Button variant="outline" size="sm" onClick={() => setIsAdding(true)} className="mt-2 text-xs h-8">
                  <Plus size={14} className="mr-1" /> 添加映射
                </Button>
              </div>
            ) : (
              <div className="grid gap-3">
                {records.map(record => (
                  <div key={record.id} className={cn("flex flex-col gap-3 p-3 rounded-lg border transition-all duration-300 shadow-sm", record.active ? "border-green-500/50 bg-green-500/5" : "border-border/50 bg-card hover:border-border")}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 font-mono text-sm">
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] text-muted-foreground mb-0.5">本地 (Local)</span>
                          <span className="font-semibold text-primary">{record.localPort}</span>
                        </div>
                        <div className="h-px w-8 bg-border flex items-center justify-center relative">
                          <div className={cn("w-1.5 h-1.5 rounded-full absolute", record.active ? "bg-green-500 animate-ping" : "bg-muted-foreground")} />
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] text-muted-foreground mb-0.5">远程 (Remote)</span>
                          <span className="font-semibold">{record.remotePort}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs text-muted-foreground flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={record.active}
                              onChange={() => toggleProxy(record)}
                              className="w-8 h-4 bg-muted/50 rounded-full appearance-none checked:bg-green-500 transition-colors relative 
                              after:content-[''] after:absolute after:w-3.5 after:h-3.5 after:bg-white after:rounded-full after:top-[1px] after:left-[1px] checked:after:translate-x-[16px] after:transition-transform"
                            />
                            {record.active ? "运行中" : "已停止"}
                          </label>
                        </div>

                        {!record.active && (
                          <div className="flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                              setIsAdding(true);
                              setEditingId(record.id);
                              setLocalPort(record.localPort.toString());
                              setRemotePort(record.remotePort.toString());
                            }}>
                              <Edit size={14} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => deleteRecord(record.id, record.proxyId)}>
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <AnimatePresence>
            {isAdding && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-border bg-muted/20 overflow-hidden"
              >
                <div className="p-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{editingId ? '编辑映射' : '新增端口映射'}</h4>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setIsAdding(false); setEditingId(null); }}>
                      <X size={14} />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">远程端口 (Remote)</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="如: 3306"
                        value={remotePort}
                        onChange={e => handleRemotePortChange(e.target.value.replace(/\D/g, ''))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">本地端口 (Local)</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="默认同远程"
                        value={localPort}
                        onChange={e => setLocalPort(e.target.value.replace(/\D/g, ''))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 mt-1">
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setIsAdding(false); setEditingId(null); }}>
                      取消
                    </Button>
                    <Button size="sm" className="h-8 text-xs gap-1.5" onClick={saveRecord}>
                      {editingId ? "保存" : "添加"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
