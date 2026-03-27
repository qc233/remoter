import React from "react";
import { SessionInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Plus, Play, ChevronDown, ChevronRight, GripVertical, Check, Minus, Upload, Search, Edit } from "lucide-react";

interface Props {
  activePage: string;
  sessions: SessionInfo[];
  selectedSessionIds: Set<string>;
  groupedSessions: Record<string, SessionInfo[]>;
  broadcastCmd: string;
  setBroadcastCmd: (cmd: string) => void;
  collapsedGroups: Set<string>;
  multiSearchTerm: string;
  setMultiSearchTerm: (term: string) => void;
  onRunCommand: () => void;
  onOpenFileDialog: () => void;
  toggleSessionSelection: (id: string) => void;
  toggleGroupSelection: (sessions: SessionInfo[]) => void;
  toggleGroupCollapse: (groupName: string) => void;
  setHistorySession: (session: SessionInfo | null) => void;
  startEdit: (e: React.MouseEvent, session: SessionInfo) => void;
  onDragStart: (e: React.DragEvent, sessionId: string) => void;
  onDrop: (e: React.DragEvent, targetGroup: string) => void;
  onDropNewGroup: (e: React.DragEvent) => void;
}

export default function MultiPage({
  activePage, selectedSessionIds, groupedSessions,
  broadcastCmd, setBroadcastCmd, collapsedGroups, multiSearchTerm,
  setMultiSearchTerm, onRunCommand, onOpenFileDialog,
  toggleSessionSelection, toggleGroupSelection, toggleGroupCollapse,
  setHistorySession, startEdit, onDragStart, onDrop, onDropNewGroup,
}: Props) {
  return (
    <div 
      className={cn(
        "absolute inset-0 p-6 overflow-auto transition-opacity duration-300",
        activePage === 'multi' ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
      )}
    >
      <Card className="mb-8 bg-card/60 backdrop-blur-sm">
        <div className="pt-6 px-6 pb-6">
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
                  onClick={onRunCommand}
                  className="gap-2 flex-1" 
                  disabled={selectedSessionIds.size === 0 || !broadcastCmd.trim()}
                >
                  <Play size={14} /> 执行命令分发
                </Button>
                <Button 
                  variant="secondary"
                  onClick={onOpenFileDialog}
                  className="gap-2" 
                  disabled={selectedSessionIds.size === 0}
                >
                  <Upload size={14} /> 分发文件
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
      
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
        <Input 
          placeholder="搜索主机名、IP 或用户名..." 
          className="pl-10 h-11 bg-card/40 border-border/50 focus:ring-primary/20"
          value={multiSearchTerm}
          onChange={e => setMultiSearchTerm(e.target.value)}
        />
      </div>
      
      <div className="flex flex-col gap-8">
        {Object.entries(groupedSessions).length === 0 && multiSearchTerm && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search size={48} className="mb-4 opacity-20" />
            <p>未找到匹配的主机</p>
          </div>
        )}
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
                    <div className="absolute top-3 right-3 z-20 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-primary opacity-0 group-hover/card:opacity-100 transition-opacity" 
                        onClick={(e) => startEdit(e, s)}
                      >
                        <Edit size={12} />
                      </Button>
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
          onDrop={onDropNewGroup}
        >
          <Plus size={24} />
          <span className="text-sm">拖动到此处创建新分组</span>
        </div>
      </div>
    </div>
  );
}
