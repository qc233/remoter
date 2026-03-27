import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedFile: File | null;
  setSelectedFile: (f: File | null) => void;
  remoteDir: string;
  setRemoteDir: (d: string) => void;
  isUploading: boolean;
  onDistribute: () => void;
}

export default function FileDistributeDialog({ open, onOpenChange, selectedFile, setSelectedFile, remoteDir, setRemoteDir, isUploading, onDistribute }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button 
            onClick={onDistribute} 
            disabled={!selectedFile || !remoteDir || isUploading}
            className="gap-2"
          >
            {isUploading ? "发送中..." : "开始分发"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
