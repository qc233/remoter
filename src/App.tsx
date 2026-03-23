import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Settings, Terminal as TerminalIcon, Users, Trash2, ChevronLeft, Play, ChevronDown, ChevronRight, GripVertical, Check, Minus, Upload, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import SSHTerminal from "./components/SSHTerminal";
import TitleBar from "./components/TitleBar";
import { cn } from "@/lib/utils";

// --- Types ---
interface SessionInfo {
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

interface Script {
  id: string;
  name: string;
  command_template: string;
  params: { name: string; label: string; default_value: string }[];
}

type Page = 'single' | 'multi' | 'settings';

interface Tab {
  id: string;
  sessionId: string | null;
}

function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [activePage, setActivePage] = useState<Page>('single');
  const [broadcastCmd, setBroadcastCmd] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [historySession, setHistorySession] = useState<SessionInfo | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // File distribution state
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const [remoteDir, setRemoteDir] = useState('/tmp');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'default', sessionId: null }]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchAddModal, setShowBatchAddModal] = useState(false);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);

  const [newSession, setNewSession] = useState<Partial<SessionInfo>>({ port: 22, group: "默认" });
  const [batchData, setBatchData] = useState({
    hosts: "",
    users: "",
    passwords: "",
    group: "默认",
    useCommonUser: false,
    useCommonPass: false,
  });
  const [scriptParams, setScriptParams] = useState<Record<string, string>>({});
  
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    refreshSessions();
    invoke<Script[]>("get_scripts").then(setScripts);

    let unlistenFn: (() => void) | undefined;
    const setupListener = async () => {
      unlistenFn = await listen<SessionInfo>("session_updated", (event) => {
        setSessions(prev => prev.map(s => s.id === event.payload.id ? event.payload : s));
      });
    };
    setupListener();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const refreshSessions = async () => {
    const data = await invoke<SessionInfo[]>("get_sessions");
    setSessions(data);
    // If no sessions selected yet and not initialized, select all by default
    if (!isInitialized && data.length > 0) {
      setSelectedSessionIds(new Set(data.map(s => s.id)));
      setIsInitialized(true);
    }
  };

  const handleFileDistribute = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target?.result as ArrayBuffer;
        if (content) {
          try {
            await invoke('distribute_file_data', {
              fileName: selectedFile.name,
              fileContent: Array.from(new Uint8Array(content)),
              remoteDir: remoteDir,
              ids: Array.from(selectedSessionIds)
            });
            setIsFileDialogOpen(false);
            setSelectedFile(null);
          } catch (err) {
            console.error("Failed to distribute file:", err);
          }
        }
        setIsUploading(false);
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (err) {
      console.error("Failed to read file:", err);
      setIsUploading(false);
    }
  };

  const groupedSessions = useMemo(() => {
    const groups: Record<string, SessionInfo[]> = {};
    sessions.forEach(s => {
      const g = s.group || "默认";
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    });
    return groups;
  }, [sessions]);

  const addTab = () => {
    const newTab = { id: Date.now().toString(), sessionId: null };
    setTabs([...tabs, newTab]);
    setActiveTabIndex(tabs.length);
  };

  const closeTab = (idx: number) => {
    if (tabs.length === 1) {
      setTabs([{ id: Date.now().toString(), sessionId: null }]);
      setActiveTabIndex(0);
      return;
    }
    const newTabs = tabs.filter((_, i) => i !== idx);
    setTabs(newTabs);
    if (activeTabIndex >= idx && activeTabIndex > 0) {
      setActiveTabIndex(activeTabIndex - 1);
    }
  };

  const selectSession = (sessionId: string | null) => {
    const newTabs = [...tabs];
    newTabs[activeTabIndex].sessionId = sessionId;
    setTabs(newTabs);
  };

  const toggleSessionSelection = (id: string) => {
    const next = new Set(selectedSessionIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedSessionIds(next);
  };

  const toggleGroupSelection = (sessionsInGroup: SessionInfo[]) => {
    const next = new Set(selectedSessionIds);
    const allSelected = sessionsInGroup.every(s => next.has(s.id));
    
    if (allSelected) {
      sessionsInGroup.forEach(s => next.delete(s.id));
    } else {
      sessionsInGroup.forEach(s => next.add(s.id));
    }
    setSelectedSessionIds(next);
  };

  const toggleGroupCollapse = (groupName: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(groupName)) {
      next.delete(groupName);
    } else {
      next.add(groupName);
    }
    setCollapsedGroups(next);
  };

  const handleAddSession = async () => {
    await invoke("add_session", { session: { ...newSession, id: "", status: "Idle", history: [] } });
    setShowAddModal(false);
    setNewSession({ port: 22, group: "默认" });
    refreshSessions();
  };

  const handleBatchAdd = async () => {
    const hosts = batchData.hosts.split("\n").map(h => h.trim()).filter(h => h);
    const usersArr = batchData.users.split("\n").map(u => u.trim()).filter(u => u);
    const passesArr = batchData.passwords.split("\n").map(p => p.trim()).filter(p => p);

    await invoke("batch_add_sessions", {
      hosts,
      users: batchData.useCommonUser ? [] : usersArr,
      passwords: batchData.useCommonPass ? [] : passesArr,
      commonUser: batchData.useCommonUser ? (usersArr[0] || "") : null,
      commonPass: batchData.useCommonPass ? (passesArr[0] || "") : null,
      keyPath: null,
      jumpHost: null,
      group: batchData.group,
    });

    setShowBatchAddModal(false);
    setBatchData({ hosts: "", users: "", passwords: "", group: "默认", useCommonUser: false, useCommonPass: false });
    refreshSessions();
  };

  const runScript = async (script: Script, params: Record<string, string>) => {
    let command = script.command_template;
    Object.entries(params).forEach(([k, v]) => command = command.replace(`{{${k}}}`, v));
    const ids = activePage === 'multi' ? Array.from(selectedSessionIds) : null;
    await invoke("run_command_all", { command, ids });
    setSelectedScript(null);
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_session", { id });
    refreshSessions();
  };

  const onDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData("sessionId", sessionId);
  };

  const onDrop = async (e: React.DragEvent, targetGroup: string) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData("sessionId");
    if (sessionId) {
      await invoke("update_session_group", { id: sessionId, group: targetGroup });
      refreshSessions();
    }
  };

  const handleCreateGroup = async (nameOverride?: string) => {
    const finalName = (nameOverride || newGroupName).trim();
    if (draggedSessionId && finalName) {
      try {
        await invoke("update_session_group", { id: draggedSessionId, group: finalName });
        setShowNewGroupModal(false);
        setDraggedSessionId(null);
        setNewGroupName("");
        await refreshSessions();
      } catch (err) {
        console.error("Failed to update group:", err);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation */}
        <nav className="w-64 border-r border-border bg-card flex flex-col p-4 gap-4">
          <div className="flex items-center gap-3 px-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
               <TerminalIcon size={18} />
            </div>
            <span className="font-bold text-xl tracking-tight">Remoter</span>
          </div>
          
          <div className="flex flex-col gap-1">
            <Button 
              variant={activePage === 'single' ? 'secondary' : 'ghost'} 
              className="justify-start gap-2" 
              onClick={() => setActivePage('single')}
            >
              <TerminalIcon size={16} /> SSH 一对一
            </Button>
            <Button 
              variant={activePage === 'multi' ? 'secondary' : 'ghost'} 
              className="justify-start gap-2" 
              onClick={() => setActivePage('multi')}
            >
              <Users size={16} /> SSH 一对多
            </Button>
            <div className="mt-auto">
              <Button 
                variant={activePage === 'settings' ? 'secondary' : 'ghost'} 
                className="w-full justify-start gap-2" 
                onClick={() => setActivePage('settings')}
              >
                <Settings size={16} /> 设置
              </Button>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          <header className="h-16 border-b border-border flex items-center justify-between px-6 bg-card/20">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowAddModal(true)}>
                <Plus size={14} /> 添加主机
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowBatchAddModal(true)}>
                <Users size={14} /> 批量添加
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">AD</div>
              <span className="text-sm font-medium">Admin</span>
            </div>
          </header>

          <div className="flex-1 relative overflow-hidden">
          {/* SSH 一对一 Page */}
          <div 
            className={cn(
              "absolute inset-0 p-6 flex flex-col transition-opacity duration-300",
              activePage === 'single' ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
            )}
          >
            <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                {tabs.map((tab, idx) => (
                <div 
                    key={tab.id} 
                    onClick={() => setActiveTabIndex(idx)}
                    className={cn(
                    "group flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer whitespace-nowrap border border-transparent",
                    activeTabIndex === idx ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted bg-muted/40 text-muted-foreground border-border"
                    )}
                >
                    <span className="max-w-[120px] truncate">
                    {tab.sessionId ? sessions.find(s => s.id === tab.sessionId)?.name || sessions.find(s => s.id === tab.sessionId)?.host || '会话' : '所有主机'}
                    </span>
                    <button 
                    onClick={(e) => { e.stopPropagation(); closeTab(idx); }}
                    className={cn("p-0.5 rounded-full transition-colors", activeTabIndex === idx ? "hover:bg-primary-foreground/20" : "hover:bg-muted-foreground/20")}
                    >
                    <Trash2 size={10} className={activeTabIndex === idx ? "" : "group-hover:opacity-100 opacity-0"} />
                    </button>
                </div>
                ))}
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={addTab}><Plus size={14} /></Button>
            </div>

            <div className="flex-1 relative min-h-0">
                {tabs.map((tab, idx) => (
                <div 
                    key={tab.id}
                    className={cn(
                    "absolute inset-0 flex flex-col min-h-0 transition-opacity duration-200",
                    activeTabIndex === idx ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
                    )}
                >
                    {tab.sessionId ? (
                    <div className="flex-1 flex flex-col min-h-0 bg-black/5 rounded-xl border border-border p-4 shadow-inner">
                        {sessions.filter(s => s.id === tab.sessionId).map(s => (
                        <div key={s.id} className="flex-1 flex flex-col min-h-0">
                            <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold">{s.name || s.host}</h2>
                            <Button variant="outline" size="sm" onClick={() => selectSession(null)} className="gap-2">
                                <ChevronLeft size={14} /> 返回列表
                            </Button>
                            </div>
                            <div className="flex-1 relative rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-black">
                                <SSHTerminal sessionId={s.id} isVisible={activeTabIndex === idx && activePage === 'single'} />
                            </div>
                        </div>
                        ))}
                    </div>
                    ) : (
                    <div className="h-full overflow-auto">
                        <h2 className="text-2xl font-bold mb-6">主机列表</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sessions.map(s => (
                            <Card key={s.id} className="hover:shadow-lg transition-all cursor-pointer group bg-card/60" onClick={() => selectSession(s.id)}>
                            <CardHeader className="pb-2">
                                <div className="flex justify-between items-start">
                                <CardTitle className="text-lg">{s.name || s.host}</CardTitle>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity" 
                                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                                >
                                    <Trash2 size={14} />
                                </Button>
                                </div>
                                <CardDescription className="font-mono text-xs">{s.user}@{s.host}</CardDescription>
                            </CardHeader>
                            </Card>
                        ))}
                        </div>
                    </div>
                    )}
                </div>
                ))}
            </div>
          </div>

          {/* SSH 一对多 Page */}
          <div 
            className={cn(
              "absolute inset-0 p-6 overflow-auto transition-opacity duration-300",
              activePage === 'multi' ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
            )}
          >
            <h2 className="text-2xl font-bold mb-6">SSH 一对多同步</h2>
            <Card className="mb-8 bg-card/60 backdrop-blur-sm">
                <CardContent className="pt-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Textarea 
                      value={broadcastCmd} 
                      onChange={e => setBroadcastCmd(e.target.value)} 
                      placeholder="输入要分发的命令 (支持多行)..." 
                      className="bg-background/50 min-h-[100px] font-mono"
                    />
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => { invoke("run_command_all", { command: broadcastCmd, ids: Array.from(selectedSessionIds) }); setBroadcastCmd(""); }} 
                        className="gap-2 flex-1" 
                        disabled={selectedSessionIds.size === 0 || !broadcastCmd.trim()}
                      >
                        <Play size={14} /> 执行命令分发
                      </Button>
                      <Button 
                        variant="secondary"
                        onClick={() => setIsFileDialogOpen(true)} 
                        className="gap-2" 
                        disabled={selectedSessionIds.size === 0}
                      >
                        <Upload size={14} /> 分发文件
                      </Button>
                    </div>
                  </div>
                </div>
                </CardContent>
            </Card>
            
            <div className="flex flex-col gap-8">
              {Object.entries(groupedSessions).map(([groupName, groupSessions]) => (
                <div 
                  key={groupName} 
                  className="flex flex-col gap-4"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDrop(e, groupName)}
                >
                  <div className="flex items-center justify-between bg-muted/30 p-2 rounded-lg border border-border/50 group/header">
                    <div className="flex items-center gap-3">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6" 
                        onClick={() => toggleGroupCollapse(groupName)}
                      >
                        {collapsedGroups.has(groupName) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </Button>
                      <div className="relative flex items-center justify-center w-4 h-4">
                        <input 
                          type="checkbox" 
                          checked={groupSessions.every(s => selectedSessionIds.has(s.id))}
                          onChange={() => toggleGroupSelection(groupSessions)}
                          className={cn(
                            "appearance-none w-4 h-4 rounded border-2 cursor-pointer transition-all focus:ring-1 focus:ring-primary/30",
                            groupSessions.some(s => selectedSessionIds.has(s.id))
                              ? "bg-primary border-primary" 
                              : "bg-transparent border-zinc-400 dark:border-zinc-500 hover:border-primary/80"
                          )}
                        />
                        {groupSessions.every(s => selectedSessionIds.has(s.id)) ? (
                          <Check size={12} className="absolute pointer-events-none text-primary-foreground stroke-[3.5]" />
                        ) : groupSessions.some(s => selectedSessionIds.has(s.id)) ? (
                          <Minus size={12} className="absolute pointer-events-none text-primary-foreground stroke-[3.5]" />
                        ) : null}
                      </div>
                      <span className="font-semibold text-sm">{groupName}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{groupSessions.length}</span>
                    </div>
                  </div>
                  
                  {!collapsedGroups.has(groupName) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {groupSessions.map(s => (
                        <Card key={s.id} 
                          draggable
                          onDragStart={(e) => onDragStart(e, s.id)}
                          className={cn(
                            "transition-all cursor-pointer relative group/card",
                            s.status === 'Running' && "border-primary shadow-primary/20",
                            s.status === 'Success' && "border-green-500 shadow-green-500/20",
                            s.status === 'Failure' && "border-destructive shadow-destructive/20"
                          )}
                          onClick={() => setHistorySession(s)}
                        >
                            <div className="absolute top-3 left-3 opacity-0 group-hover/card:opacity-40 cursor-grab active:cursor-grabbing">
                                <GripVertical size={14} />
                            </div>
                            <div className="absolute top-3 right-3 z-20" onClick={(e) => e.stopPropagation()}>
                              <div className="relative flex items-center justify-center w-4 h-4">
                                <input 
                                  type="checkbox" 
                                  checked={selectedSessionIds.has(s.id)}
                                  onChange={() => toggleSessionSelection(s.id)}
                                  className={cn(
                                    "appearance-none w-4 h-4 rounded border-2 cursor-pointer transition-all focus:ring-1 focus:ring-primary/30",
                                    selectedSessionIds.has(s.id)
                                      ? "bg-primary border-primary" 
                                      : "bg-transparent border-zinc-400 dark:border-zinc-500 hover:border-primary/80"
                                  )}
                                />
                                {selectedSessionIds.has(s.id) && (
                                  <Check size={12} className="absolute pointer-events-none text-primary-foreground stroke-[3.5]" />
                                )}
                              </div>
                            </div>
                            <CardHeader className="p-4">
                            <CardTitle className="text-sm pr-6 ml-4">{s.name || s.host}</CardTitle>
                            <div className="flex items-center gap-2 mt-1 ml-4">
                                <div className={cn(
                                "w-2 h-2 rounded-full",
                                s.status === 'Idle' && "bg-muted",
                                s.status === 'Running' && "bg-primary animate-pulse",
                                s.status === 'Success' && "bg-green-500",
                                s.status === 'Failure' && "bg-destructive"
                                )} />
                                <span className="text-xs text-muted-foreground">{s.status}</span>
                            </div>
                            </CardHeader>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              
              <div 
                className="border-2 border-dashed border-muted rounded-xl p-8 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/10 transition-colors"
                onDragOver={(e) => e.preventDefault()}
                onDrop={async (e) => {
                  e.preventDefault();
                  const sessionId = e.dataTransfer.getData("sessionId");
                  if (sessionId) {
                    setDraggedSessionId(sessionId);
                    setNewGroupName("");
                    setShowNewGroupModal(true);
                  }
                }}
              >
                <Plus size={24} />
                <span className="text-sm">拖动到此处创建新分组</span>
              </div>
            </div>
          </div>

          {/* Settings Page */}
          <div 
            className={cn(
              "absolute inset-0 p-6 overflow-auto transition-opacity duration-300",
              activePage === 'settings' ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
            )}
          >
            <h2 className="text-2xl font-bold mb-6">设置</h2>
            <Card className="bg-card/60">
                <CardHeader>
                <CardTitle>持久化存储</CardTitle>
                <CardDescription>所有数据保存在本地应用目录中的 config.json 文件中 (明文)。</CardDescription>
                </CardHeader>
                <CardFooter>
                <Button variant="outline" onClick={() => invoke("save_to_disk")}>强制保存</Button>
                </CardFooter>
            </Card>
          </div>
        </div>
      </main>

      {/* Right Script Sidebar */}
      {activePage !== 'settings' && (
        <aside className="w-64 border-l border-border bg-card/40 backdrop-blur-md flex flex-col p-4 gap-4">
          <h3 className="font-semibold px-2 mb-2">快捷脚本</h3>
          <div className="flex flex-col gap-2">
            {scripts.map(script => (
              <Button 
                key={script.id} 
                variant="outline" 
                className="justify-start h-auto py-3 px-4 text-left font-normal bg-card/50 hover:bg-card transition-colors"
                onClick={() => {
                  if (script.params.length > 0) {
                    const defaults: Record<string, string> = {}; 
                    script.params.forEach(p => defaults[p.name] = p.default_value);
                    setScriptParams(defaults); setSelectedScript(script);
                  } else { runScript(script, {}); }
                }}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{script.name}</span>
                  <span className="text-[10px] text-muted-foreground truncate opacity-70 font-mono">{script.command_template}</span>
                </div>
              </Button>
            ))}
          </div>
        </aside>
      )}

      </div>

      {/* Add Modal */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加主机</DialogTitle>
            <DialogDescription>输入远程主机的连接详情。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">名称</label>
              <Input placeholder="My Server" onChange={e => setNewSession({ ...newSession, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">主机/IP</label>
              <Input placeholder="1.2.3.4" onChange={e => setNewSession({ ...newSession, host: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">用户名</label>
                <Input onChange={e => setNewSession({ ...newSession, user: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">密码</label>
                <Input type="password" onChange={e => setNewSession({ ...newSession, password: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">分组</label>
              <Input value={newSession.group} placeholder="默认" onChange={e => setNewSession({ ...newSession, group: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">密钥路径 (可选)</label>
              <Input placeholder="/home/user/.ssh/id_rsa" onChange={e => setNewSession({ ...newSession, key_path: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddModal(false)}>取消</Button>
            <Button onClick={handleAddSession}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Add Modal */}
      <Dialog open={showBatchAddModal} onOpenChange={setShowBatchAddModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量添加主机</DialogTitle>
            <DialogDescription>
              请输入主机列表、用户名和密码，每行一个。
            </DialogDescription>
          </DialogHeader>
          <div className="mb-4">
            <label className="text-sm font-medium">目标分组</label>
            <Input value={batchData.group} placeholder="默认" onChange={e => setBatchData({...batchData, group: e.target.value})} className="mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">主机列表 (一行一个)</label>
              <Textarea 
                placeholder="192.168.1.1&#10;192.168.1.2" 
                className="h-64 font-mono text-xs"
                value={batchData.hosts}
                onChange={e => setBatchData({...batchData, hosts: e.target.value})}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">用户名</label>
                <div className="flex items-center gap-1">
                  <input 
                    type="checkbox" 
                    id="commonUser"
                    checked={batchData.useCommonUser}
                    onChange={e => setBatchData({...batchData, useCommonUser: e.target.checked})}
                    className="w-3 h-3 accent-primary"
                  />
                  <label htmlFor="commonUser" className="text-[10px] text-muted-foreground cursor-pointer">相同用户名</label>
                </div>
              </div>
              <Textarea 
                placeholder={batchData.useCommonUser ? "所有主机通用用户名" : "user1&#10;user2"} 
                className="h-64 font-mono text-xs"
                value={batchData.users}
                onChange={e => setBatchData({...batchData, users: e.target.value})}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">密码</label>
                <div className="flex items-center gap-1">
                  <input 
                    type="checkbox" 
                    id="commonPass"
                    checked={batchData.useCommonPass}
                    onChange={e => setBatchData({...batchData, useCommonPass: e.target.checked})}
                    className="w-3 h-3 accent-primary"
                  />
                  <label htmlFor="commonPass" className="text-[10px] text-muted-foreground cursor-pointer">相同密码</label>
                </div>
              </div>
              <Textarea 
                placeholder={batchData.useCommonPass ? "所有主机通用密码" : "pass1&#10;pass2"} 
                className="h-64 font-mono text-xs"
                value={batchData.passwords}
                onChange={e => setBatchData({...batchData, passwords: e.target.value})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchAddModal(false)}>取消</Button>
            <Button onClick={handleBatchAdd}>批量添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Script Modal */}
      <Dialog open={!!selectedScript} onOpenChange={(open) => !open && setSelectedScript(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedScript?.name}</DialogTitle>
            <DialogDescription>配置脚本参数并执行。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {selectedScript?.params.map(p => (
              <div key={p.name} className="grid gap-2">
                <label className="text-sm font-medium">{p.label}</label>
                <Input value={scriptParams[p.name]} onChange={e => setScriptParams({ ...scriptParams, [p.name]: e.target.value })} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedScript(null)}>取消</Button>
            <Button onClick={() => selectedScript && runScript(selectedScript, scriptParams)}>执行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Modal */}
      <Dialog open={!!historySession} onOpenChange={(open) => !open && setHistorySession(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {sessions.find(s => s.id === historySession?.id)?.name || sessions.find(s => s.id === historySession?.id)?.host} - 最近执行结果
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto mt-4 space-y-4">
            {sessions.find(s => s.id === historySession?.id)?.history && (sessions.find(s => s.id === historySession?.id)?.history?.length ?? 0) > 0 ? (
              [...(sessions.find(s => s.id === historySession?.id)?.history ?? [])].reverse().map((h, i) => (
                <div key={i} className="p-3 rounded-lg bg-black/10 border border-border font-mono text-sm whitespace-pre-wrap">
                  {h}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">暂无执行历史</div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setHistorySession(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Group Modal */}
      <Dialog open={showNewGroupModal} onOpenChange={setShowNewGroupModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新分组</DialogTitle>
            <DialogDescription>输入新分组名称，该主机将被移动到此分组。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">分组名称</label>
              <Input 
                autoFocus 
                value={newGroupName} 
                onChange={e => setNewGroupName(e.target.value)} 
                onKeyDown={(e) => { 
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateGroup(newGroupName); 
                  }
                }}
                placeholder="例如: 生产服务器" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewGroupModal(false)}>取消</Button>
            <Button onClick={() => handleCreateGroup(newGroupName)}>创建并移动</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Distribution Modal */}
      <Dialog open={isFileDialogOpen} onOpenChange={setIsFileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>分发文件</DialogTitle>
            <DialogDescription>选择一个本地文件并输入目标目录，文件将被发送到所有选中的主机。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">选择文件</label>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start gap-2 h-10 overflow-hidden text-ellipsis"
                  onClick={() => document.getElementById('fileInput')?.click()}
                >
                  <FileText size={16} className="shrink-0" />
                  {selectedFile ? selectedFile.name : "点击选择文件..."}
                </Button>
                <input 
                  id="fileInput"
                  type="file" 
                  className="hidden" 
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">目标目录</label>
              <Input 
                value={remoteDir} 
                onChange={e => setRemoteDir(e.target.value)} 
                placeholder="例如: /tmp" 
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFileDialogOpen(false)}>取消</Button>
            <Button 
              onClick={handleFileDistribute} 
              disabled={!selectedFile || !remoteDir || isUploading}
              className="gap-2"
            >
              {isUploading ? "发送中..." : "开始分发"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
