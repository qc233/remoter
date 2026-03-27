import { SessionInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface Props {
  historySession: SessionInfo | null;
  sessions: SessionInfo[];
  onClose: () => void;
}

export default function HistoryDialog({ historySession, sessions, onClose }: Props) {
  const currentSession = sessions.find(s => s.id === historySession?.id);
  
  return (
    <Dialog open={!!historySession} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {currentSession?.name || currentSession?.host} - 最近执行结果
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto mt-4 space-y-4">
          {currentSession?.history && currentSession.history.length > 0 ? (
            [...currentSession.history].reverse().map((h, i) => (
              <div key={i} className="p-3 rounded-lg bg-black/10 border border-border font-mono text-sm whitespace-pre-wrap">
                {h}
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">暂无执行历史</div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
