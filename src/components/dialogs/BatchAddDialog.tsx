import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface BatchData {
  hosts: string;
  users: string;
  passwords: string;
  group: string;
  useCommonUser: boolean;
  useCommonPass: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchData: BatchData;
  setBatchData: (d: BatchData) => void;
  onSubmit: () => void;
}

export default function BatchAddDialog({ open, onOpenChange, batchData, setBatchData, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              placeholder={"192.168.1.1\n192.168.1.2"} 
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
              placeholder={batchData.useCommonUser ? "所有主机通用用户名" : "user1\nuser2"} 
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
              placeholder={batchData.useCommonPass ? "所有主机通用密码" : "pass1\npass2"} 
              className="h-64 font-mono text-xs"
              value={batchData.passwords}
              onChange={e => setBatchData({...batchData, passwords: e.target.value})}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={onSubmit}>批量添加</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
