import { Script } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Plus, Settings, Trash2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scripts: Script[];
  onEdit: (script: Script) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

export default function ManageScriptsDialog({ open, onOpenChange, scripts, onEdit, onDelete, onNew }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>管理快捷脚本</DialogTitle>
          <DialogDescription>管理您的快捷脚本，您可以编辑或删除现有的脚本。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4 max-h-[60vh] overflow-y-auto overflow-x-hidden w-full">
          {scripts.map(s => (
            <div key={s.id} className="flex items-center justify-between p-3 border border-border rounded-lg bg-card/40 w-full min-w-0">
              <div className="flex flex-col overflow-hidden mr-4 flex-1 min-w-0">
                <span className="font-medium truncate">{s.name}</span>
                <span className="text-xs text-muted-foreground truncate font-mono opacity-60">{s.command_template}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8"
                  onClick={() => onEdit(s)}
                >
                  <Settings size={14} />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-destructive"
                  onClick={() => onDelete(s.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
          {scripts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">暂无脚本</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button onClick={onNew}>
            <Plus size={14} className="mr-2" /> 新建脚本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
