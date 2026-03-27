import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newGroupName: string;
  setNewGroupName: (name: string) => void;
  onCreateGroup: (name: string) => void;
}

export default function NewGroupDialog({ open, onOpenChange, newGroupName, setNewGroupName, onCreateGroup }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  onCreateGroup(newGroupName); 
                }
              }}
              placeholder="例如: 生产服务器" 
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => onCreateGroup(newGroupName)}>创建并移动</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
