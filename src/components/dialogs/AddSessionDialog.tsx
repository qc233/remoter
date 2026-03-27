import { SessionInfo } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEditing: boolean;
  newSession: Partial<SessionInfo>;
  setNewSession: (s: Partial<SessionInfo>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function AddSessionDialog({ open, onOpenChange, isEditing, newSession, setNewSession, onSave, onCancel }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "编辑主机" : "添加主机"}</DialogTitle>
          <DialogDescription>{isEditing ? "修改远程主机的连接详情。" : "输入远程主机的连接详情。"}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">名称</label>
            <Input value={newSession.name || ""} placeholder="My Server" onChange={e => setNewSession({ ...newSession, name: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">主机/IP</label>
            <Input value={newSession.host || ""} placeholder="1.2.3.4" onChange={e => setNewSession({ ...newSession, host: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">用户名</label>
              <Input value={newSession.user || ""} onChange={e => setNewSession({ ...newSession, user: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">密码</label>
              <Input value={newSession.password || ""} type="password" onChange={e => setNewSession({ ...newSession, password: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">分组</label>
            <Input value={newSession.group || "默认"} placeholder="默认" onChange={e => setNewSession({ ...newSession, group: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">密钥路径 (可选)</label>
            <Input value={newSession.key_path || ""} placeholder="/home/user/.ssh/id_rsa" onChange={e => setNewSession({ ...newSession, key_path: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={onSave}>{isEditing ? "保存修改" : "添加"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
