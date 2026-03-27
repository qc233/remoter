import React from "react";
import { SessionInfo, Tab } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import SSHTerminal from "@/components/SSHTerminal";
import SFTPDrawer from "@/components/SFTPDrawer";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Search, Edit, HardDrive } from "lucide-react";

interface Props {
  sessions: SessionInfo[];
  tabs: Tab[];
  activeTabIndex: number;
  setActiveTabIndex: (idx: number) => void;
  addTab: () => void;
  closeTab: (idx: number) => void;
  selectSession: (sessionId: string | null) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filteredSessions: SessionInfo[];
  sessionPaths: Record<string, string>;
  setSessionPaths: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sftpOpenSessions: Set<string>;
  setSftpOpenSessions: React.Dispatch<React.SetStateAction<Set<string>>>;
  terminalFocusKey: Record<string, number>;
  setTerminalFocusKey: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  startEdit: (e: React.MouseEvent, session: SessionInfo) => void;
  handleDelete: (id: string) => void;
  activePage: string;
}

export default function SinglePage({
  sessions, tabs, activeTabIndex, setActiveTabIndex, addTab, closeTab,
  selectSession, searchTerm, setSearchTerm, filteredSessions,
  sessionPaths, setSessionPaths, sftpOpenSessions, setSftpOpenSessions,
  terminalFocusKey, setTerminalFocusKey, startEdit, handleDelete, activePage,
}: Props) {
  return (
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
            {tab.sessionId && tab.instanceId ? (
              <div className="flex-1 flex flex-col min-h-0 bg-black/5 rounded-xl border border-border p-4 shadow-inner relative group/terminal">
                {sessions.filter(s => s.id === tab.sessionId).map(s => (
                  <div key={s.id} className="flex-1 flex flex-col min-h-0 relative">
                    <SFTPDrawer 
                      instanceId={tab.instanceId!}
                      currentPath={sessionPaths[tab.instanceId!] || "/"}
                      onPathChange={(path) => setSessionPaths(prev => ({ ...prev, [tab.instanceId!]: path }))}
                      isOpen={sftpOpenSessions.has(tab.instanceId!)}
                      onClose={() => {
                        const next = new Set(sftpOpenSessions);
                        next.delete(tab.instanceId!);
                        setSftpOpenSessions(next);
                        setTerminalFocusKey(prev => ({ ...prev, [tab.instanceId!]: Date.now() }));
                      }}
                    />
                    
                    {!sftpOpenSessions.has(tab.instanceId!) && (
                      <div className="absolute top-3 right-5 z-[60] opacity-0 group-hover/terminal:opacity-100 transition-opacity">
                        <Button 
                          variant="secondary" 
                          size="sm" 
                          className="h-8 gap-1.5 shadow-lg border border-border/50 bg-card/80 backdrop-blur-sm hover:bg-card"
                          onClick={() => {
                            const next = new Set(sftpOpenSessions);
                            next.add(tab.instanceId!);
                            setSftpOpenSessions(next);
                          }}
                        >
                          <HardDrive size={14} />
                          SFTP
                        </Button>
                      </div>
                    )}

                    <div className="flex-1 relative rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-black">
                      <SSHTerminal 
                        sessionId={s.id} 
                        instanceId={tab.instanceId!}
                        isVisible={activeTabIndex === idx && activePage === 'single'} 
                        isFocused={!!terminalFocusKey[tab.instanceId!]}
                        onPathChange={(path) => {
                          setSessionPaths(prev => ({ ...prev, [tab.instanceId!]: path }));
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input 
                    placeholder="搜索主机名、IP 或用户名..." 
                    className="pl-10 h-11 bg-card/40 border-border/50 focus:ring-primary/20"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="flex-1 overflow-auto pr-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-6">
                    {filteredSessions.map(s => (
                      <Card key={s.id} className="hover:shadow-lg transition-all cursor-pointer group bg-card/60" onClick={() => selectSession(s.id)}>
                        <CardHeader className="pb-2">
                          <div className="flex justify-between items-start">
                            <CardTitle className="text-lg">{s.name || s.host}</CardTitle>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-muted-foreground hover:text-primary" 
                                onClick={(e) => startEdit(e, s)}
                              >
                                <Edit size={14} />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-destructive" 
                                onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                          <CardDescription className="font-mono text-xs">{s.user}@{s.host}</CardDescription>
                        </CardHeader>
                      </Card>
                    ))}
                    {filteredSessions.length === 0 && (
                      <div className="col-span-full flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Search size={48} className="mb-4 opacity-20" />
                        <p>未找到匹配的主机</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
