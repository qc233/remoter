import { Script } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingScript: Script;
  setEditingScript: (s: Script) => void;
  onSave: () => void;
}

export default function EditScriptDialog({ open, onOpenChange, editingScript, setEditingScript, onSave }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{editingScript.id ? "编辑脚本" : "新建脚本"}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto py-4 space-y-6 pr-1">
          <div className="grid gap-2">
            <label className="text-sm font-medium">脚本名称</label>
            <Input 
              value={editingScript.name} 
              onChange={e => setEditingScript({ ...editingScript, name: e.target.value })} 
              placeholder="例如: 重启 Nginx"
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">脚本内容</label>
            <Textarea 
              value={editingScript.command_template} 
              onChange={e => setEditingScript({ ...editingScript, command_template: e.target.value })} 
              placeholder="sudo systemctl restart nginx"
              className="font-mono min-h-[120px]"
            />
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">环境变量</label>
              <Button 
                variant="outline" 
                size="sm" 
                className="h-8 gap-1"
                onClick={() => {
                  const newVars = [...editingScript.vars, { name: "", required: false, default_value: "" }];
                  setEditingScript({ ...editingScript, vars: newVars });
                }}
              >
                <Plus size={14} /> 添加变量
              </Button>
            </div>
            
            <div className="space-y-3">
              {editingScript.vars.map((v, i) => (
                <div key={i} className="flex items-end gap-3 p-3 border border-border/50 rounded-lg bg-muted/20 relative group">
                  <div className="flex-1 grid gap-2">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">变量名</label>
                    <Input 
                      value={v.name} 
                      onChange={e => {
                        const newVars = [...editingScript.vars];
                        newVars[i].name = e.target.value;
                        setEditingScript({ ...editingScript, vars: newVars });
                      }} 
                      placeholder="VAR_NAME"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="flex-1 grid gap-2">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">默认值</label>
                    <Input 
                      value={v.default_value} 
                      onChange={e => {
                        const newVars = [...editingScript.vars];
                        newVars[i].default_value = e.target.value;
                        setEditingScript({ ...editingScript, vars: newVars });
                      }} 
                      placeholder="默认值"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-2 items-center pb-1 px-2">
                    <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">必填</label>
                    <input 
                      type="checkbox" 
                      checked={v.required} 
                      onChange={e => {
                        const newVars = [...editingScript.vars];
                        newVars[i].required = e.target.checked;
                        setEditingScript({ ...editingScript, vars: newVars });
                      }}
                      className="w-4 h-4 rounded border-2 cursor-pointer transition-all"
                    />
                  </div>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      const newVars = editingScript.vars.filter((_, idx) => idx !== i);
                      setEditingScript({ ...editingScript, vars: newVars });
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {editingScript.vars.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                  未添加环境变量
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="pt-4 border-t border-border mt-auto">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button 
            onClick={onSave}
            disabled={!editingScript.name || !editingScript.command_template}
          >
            保存脚本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
