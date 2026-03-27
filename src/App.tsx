import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Terminal as TerminalIcon, Users, Settings } from "lucide-react";

import { SessionInfo, Script, Page, Tab } from "@/types";
import { Button } from "@/components/ui/button";
import TitleBar from "./components/TitleBar";
import ScriptSidebar from "./components/ScriptSidebar";
import SinglePage from "./components/pages/SinglePage";
import MultiPage from "./components/pages/MultiPage";
import SettingsPage from "./components/pages/SettingsPage";
import AddSessionDialog from "./components/dialogs/AddSessionDialog";
import BatchAddDialog from "./components/dialogs/BatchAddDialog";
import ScriptRunDialog from "./components/dialogs/ScriptRunDialog";
import ManageScriptsDialog from "./components/dialogs/ManageScriptsDialog";
import EditScriptDialog from "./components/dialogs/EditScriptDialog";
import HistoryDialog from "./components/dialogs/HistoryDialog";
import NewGroupDialog from "./components/dialogs/NewGroupDialog";
import FileDistributeDialog from "./components/dialogs/FileDistributeDialog";

function App() {
  // --- Core State ---
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [activePage, setActivePage] = useState<Page>('single');
  const [isInitialized, setIsInitialized] = useState(false);

  // --- Single Page State ---
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'default', sessionId: null, instanceId: null }]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionPaths, setSessionPaths] = useState<Record<string, string>>({});
  const [sftpOpenSessions, setSftpOpenSessions] = useState<Set<string>>(new Set());
  const [terminalFocusKey, setTerminalFocusKey] = useState<Record<string, number>>({});

  // --- Multi Page State ---
  const [broadcastCmd, setBroadcastCmd] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [multiSearchTerm, setMultiSearchTerm] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [historySession, setHistorySession] = useState<SessionInfo | null>(null);

  // --- File Distribution ---
  const [isFileDialogOpen, setIsFileDialogOpen] = useState(false);
  const [remoteDir, setRemoteDir] = useState('/tmp');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // --- Session Add/Edit ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showBatchAddModal, setShowBatchAddModal] = useState(false);
  const [newSession, setNewSession] = useState<Partial<SessionInfo>>({ port: 22, group: "默认" });
  const [batchData, setBatchData] = useState({
    hosts: "", users: "", passwords: "", group: "默认",
    useCommonUser: false, useCommonPass: false,
  });

  // --- Script State ---
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [scriptParams, setScriptParams] = useState<Record<string, string>>({});
  const [showManageScriptsModal, setShowManageScriptsModal] = useState(false);
  const [showEditScriptModal, setShowEditScriptModal] = useState(false);
  const [editingScript, setEditingScript] = useState<Script>({ id: "", name: "", command_template: "", vars: [] });

  // --- Group ---
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);

  // === Effects ===
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
    return () => { if (unlistenFn) unlistenFn(); };
  }, []);

  const refreshSessions = async () => {
    const data = await invoke<SessionInfo[]>("get_sessions");
    setSessions(data);
    if (!isInitialized && data.length > 0) {
      setSelectedSessionIds(new Set(data.map(s => s.id)));
      setIsInitialized(true);
    }
  };

  // === Computed ===
  const filteredSessions = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return sessions;
    return sessions.filter(s =>
      (s.name && s.name.toLowerCase().includes(term)) ||
      (s.host && s.host.toLowerCase().includes(term)) ||
      (s.user && s.user.toLowerCase().includes(term))
    );
  }, [sessions, searchTerm]);

  const groupedSessions = useMemo(() => {
    const groups: Record<string, SessionInfo[]> = {};
    const term = multiSearchTerm.toLowerCase().trim();
    sessions.forEach(s => {
      const isMatch = !term || (
        (s.name && s.name.toLowerCase().includes(term)) ||
        (s.host && s.host.toLowerCase().includes(term)) ||
        (s.user && s.user.toLowerCase().includes(term))
      );
      if (isMatch) {
        const g = s.group || "默认";
        if (!groups[g]) groups[g] = [];
        groups[g].push(s);
      }
    });
    return groups;
  }, [sessions, multiSearchTerm]);

  // === Handlers ===
  const addTab = () => {
    const newTab = { id: Date.now().toString(), sessionId: null, instanceId: null };
    setTabs([...tabs, newTab]);
    setActiveTabIndex(tabs.length);
  };

  const closeTab = (idx: number) => {
    const tabToClose = tabs[idx];
    if (tabToClose.instanceId) invoke('stop_ssh_session', { instanceId: tabToClose.instanceId });
    if (tabs.length === 1) {
      setTabs([{ id: Date.now().toString(), sessionId: null, instanceId: null }]);
      setActiveTabIndex(0);
      return;
    }
    const newTabs = tabs.filter((_, i) => i !== idx);
    setTabs(newTabs);
    if (activeTabIndex >= idx && activeTabIndex > 0) setActiveTabIndex(activeTabIndex - 1);
  };

  const selectSession = (sessionId: string | null) => {
    const newTabs = [...tabs];
    newTabs[activeTabIndex].sessionId = sessionId;
    newTabs[activeTabIndex].instanceId = sessionId ? `${sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` : null;
    setTabs(newTabs);
  };

  const toggleSessionSelection = (id: string) => {
    const next = new Set(selectedSessionIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedSessionIds(next);
  };

  const toggleGroupSelection = (sessionsInGroup: SessionInfo[]) => {
    const next = new Set(selectedSessionIds);
    const allSelected = sessionsInGroup.every(s => next.has(s.id));
    sessionsInGroup.forEach(s => allSelected ? next.delete(s.id) : next.add(s.id));
    setSelectedSessionIds(next);
  };

  const toggleGroupCollapse = (groupName: string) => {
    const next = new Set(collapsedGroups);
    next.has(groupName) ? next.delete(groupName) : next.add(groupName);
    setCollapsedGroups(next);
  };

  const startEdit = (e: React.MouseEvent, session: SessionInfo) => {
    e.stopPropagation();
    setNewSession(session);
    setIsEditing(true);
    setShowAddModal(true);
  };

  const handleAddSession = async () => {
    await invoke("add_session", {
      session: {
        ...newSession,
        id: isEditing ? newSession.id : "",
        status: isEditing ? (newSession.status || "Idle") : "Idle",
        history: isEditing ? (newSession.history || []) : []
      }
    });
    setShowAddModal(false);
    setIsEditing(false);
    setNewSession({ port: 22, group: "默认" });
    refreshSessions();
  };

  const handleBatchAdd = async () => {
    const hosts = batchData.hosts.split("\n").map(h => h.trim()).filter(h => h);
    const usersArr = batchData.users.split("\n").map(u => u.trim()).filter(u => u);
    const passesArr = batchData.passwords.split("\n").map(p => p.trim()).filter(p => p);
    await invoke("batch_add_sessions", {
      hosts, users: batchData.useCommonUser ? [] : usersArr,
      passwords: batchData.useCommonPass ? [] : passesArr,
      commonUser: batchData.useCommonUser ? (usersArr[0] || "") : null,
      commonPass: batchData.useCommonPass ? (passesArr[0] || "") : null,
      keyPath: null, jumpHost: null, group: batchData.group,
    });
    setShowBatchAddModal(false);
    setBatchData({ hosts: "", users: "", passwords: "", group: "默认", useCommonUser: false, useCommonPass: false });
    refreshSessions();
  };

  const handleDelete = async (id: string) => {
    await invoke("delete_session", { id });
    refreshSessions();
  };

  const runScript = async (script: Script, params: Record<string, string>) => {
    const command = script.command_template;
    if (activePage === 'single') {
      const activeTab = tabs[activeTabIndex];
      if (activeTab && activeTab.instanceId) {
        let finalCommand = command;
        const envEntries = Object.entries(params);
        if (envEntries.length > 0) {
          const envPrefix = envEntries.map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`).join('\n');
          finalCommand = `${envPrefix}\n\n${command}`;
        }
        if (!finalCommand.endsWith('\n')) finalCommand += '\n';
        await invoke("send_ssh_data", { instanceId: activeTab.instanceId, data: finalCommand });
        setSelectedScript(null);
        return;
      }
    }
    let ids: string[] = [];
    if (activePage === 'multi') ids = Array.from(selectedSessionIds);
    if (ids.length > 0) await invoke("run_command_all", { command, vars: params, ids });
    setSelectedScript(null);
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
              fileName: selectedFile.name, fileContent: new Uint8Array(content),
              remoteDir, ids: Array.from(selectedSessionIds)
            });
            setIsFileDialogOpen(false);
            setSelectedFile(null);
          } catch (err) { console.error("Failed to distribute file:", err); }
        }
        setIsUploading(false);
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (err) { console.error("Failed to read file:", err); setIsUploading(false); }
  };

  const handleSaveScript = async () => {
    await invoke("add_script", { script: editingScript });
    setShowEditScriptModal(false);
    const updatedScripts = await invoke<Script[]>("get_scripts");
    setScripts(updatedScripts);
  };

  const handleDeleteScript = async (id: string) => {
    await invoke("delete_script", { id });
    const updatedScripts = await invoke<Script[]>("get_scripts");
    setScripts(updatedScripts);
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
      } catch (err) { console.error("Failed to update group:", err); }
    }
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

  const handleScriptClick = (script: Script) => {
    if (script.vars.length > 0) {
      const defaults: Record<string, string> = {};
      script.vars.forEach(v => defaults[v.name] = v.default_value);
      setScriptParams(defaults);
      setSelectedScript(script);
    } else {
      runScript(script, {});
    }
  };

  // === Render ===
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
            <Button variant={activePage === 'single' ? 'secondary' : 'ghost'} className="justify-start gap-2" onClick={() => setActivePage('single')}>
              <TerminalIcon size={16} /> SSH
            </Button>
            <Button variant={activePage === 'multi' ? 'secondary' : 'ghost'} className="justify-start gap-2" onClick={() => setActivePage('multi')}>
              <Users size={16} /> FORK
            </Button>
            <div className="mt-auto">
              <Button variant={activePage === 'settings' ? 'secondary' : 'ghost'} className="w-full justify-start gap-2" onClick={() => setActivePage('settings')}>
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
          </header>

          <div className="flex-1 relative overflow-hidden">
            <SinglePage
              sessions={sessions} tabs={tabs} activeTabIndex={activeTabIndex}
              setActiveTabIndex={setActiveTabIndex} addTab={addTab} closeTab={closeTab}
              selectSession={selectSession} searchTerm={searchTerm} setSearchTerm={setSearchTerm}
              filteredSessions={filteredSessions} sessionPaths={sessionPaths}
              setSessionPaths={setSessionPaths} sftpOpenSessions={sftpOpenSessions}
              setSftpOpenSessions={setSftpOpenSessions} terminalFocusKey={terminalFocusKey}
              setTerminalFocusKey={setTerminalFocusKey} startEdit={startEdit}
              handleDelete={handleDelete} activePage={activePage}
            />

            <MultiPage
              activePage={activePage} sessions={sessions}
              selectedSessionIds={selectedSessionIds} groupedSessions={groupedSessions}
              broadcastCmd={broadcastCmd} setBroadcastCmd={setBroadcastCmd}
              collapsedGroups={collapsedGroups} multiSearchTerm={multiSearchTerm}
              setMultiSearchTerm={setMultiSearchTerm}
              onRunCommand={() => { invoke("run_command_all", { command: broadcastCmd, vars: null, ids: Array.from(selectedSessionIds) }); setBroadcastCmd(""); }}
              onOpenFileDialog={() => setIsFileDialogOpen(true)}
              toggleSessionSelection={toggleSessionSelection}
              toggleGroupSelection={toggleGroupSelection}
              toggleGroupCollapse={toggleGroupCollapse}
              setHistorySession={setHistorySession}
              startEdit={startEdit}
              onDragStart={onDragStart}
              onDrop={onDrop}
              onDropNewGroup={async (e) => {
                e.preventDefault();
                const sessionId = e.dataTransfer.getData("sessionId");
                if (sessionId) { setDraggedSessionId(sessionId); setNewGroupName(""); setShowNewGroupModal(true); }
              }}
            />

            <SettingsPage activePage={activePage} />
          </div>
        </main>

        {/* Right Script Sidebar */}
        {activePage !== 'settings' && (
          <ScriptSidebar
            scripts={scripts}
            onRunScript={handleScriptClick}
            onManageScripts={() => setShowManageScriptsModal(true)}
            onNewScript={() => { setEditingScript({ id: "", name: "", command_template: "", vars: [] }); setShowEditScriptModal(true); }}
          />
        )}
      </div>

      {/* Dialogs */}
      <AddSessionDialog
        open={showAddModal}
        onOpenChange={(open) => { setShowAddModal(open); if (!open) { setIsEditing(false); setNewSession({ port: 22, group: "默认" }); } }}
        isEditing={isEditing} newSession={newSession} setNewSession={setNewSession}
        onSave={handleAddSession}
        onCancel={() => { setShowAddModal(false); setIsEditing(false); setNewSession({ port: 22, group: "默认" }); }}
      />

      <BatchAddDialog
        open={showBatchAddModal} onOpenChange={setShowBatchAddModal}
        batchData={batchData} setBatchData={setBatchData} onSubmit={handleBatchAdd}
      />

      <ScriptRunDialog
        selectedScript={selectedScript}
        onOpenChange={() => setSelectedScript(null)}
        scriptParams={scriptParams} setScriptParams={setScriptParams}
        onRun={runScript}
      />

      <ManageScriptsDialog
        open={showManageScriptsModal} onOpenChange={setShowManageScriptsModal}
        scripts={scripts}
        onEdit={(s) => { setEditingScript(JSON.parse(JSON.stringify(s))); setShowEditScriptModal(true); }}
        onDelete={handleDeleteScript}
        onNew={() => { setEditingScript({ id: "", name: "", command_template: "", vars: [] }); setShowEditScriptModal(true); }}
      />

      <EditScriptDialog
        open={showEditScriptModal} onOpenChange={setShowEditScriptModal}
        editingScript={editingScript} setEditingScript={setEditingScript}
        onSave={handleSaveScript}
      />

      <HistoryDialog historySession={historySession} sessions={sessions} onClose={() => setHistorySession(null)} />

      <NewGroupDialog
        open={showNewGroupModal} onOpenChange={setShowNewGroupModal}
        newGroupName={newGroupName} setNewGroupName={setNewGroupName}
        onCreateGroup={handleCreateGroup}
      />

      <FileDistributeDialog
        open={isFileDialogOpen} onOpenChange={setIsFileDialogOpen}
        selectedFile={selectedFile} setSelectedFile={setSelectedFile}
        remoteDir={remoteDir} setRemoteDir={setRemoteDir}
        isUploading={isUploading} onDistribute={handleFileDistribute}
      />
    </div>
  );
}

export default App;
