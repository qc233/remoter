import { Script } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Props {
  selectedScript: Script | null;
  onOpenChange: (open: boolean) => void;
  scriptParams: Record<string, string>;
  setScriptParams: (params: Record<string, string>) => void;
  onRun: (script: Script, params: Record<string, string>) => void;
}

export default function ScriptRunDialog({ selectedScript, onOpenChange, scriptParams, setScriptParams, onRun }: Props) {
  return (
    <Dialog open={!!selectedScript} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{selectedScript?.name}</DialogTitle>
          <DialogDescription>
            {selectedScript && selectedScript.vars.length > 0 
              ? "配置脚本参数并执行。" 
              : "确认要执行此脚本吗？"}
          </DialogDescription>
        </DialogHeader>
        {selectedScript && selectedScript.vars.length > 0 && (
          <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto px-1">
            {selectedScript.vars.map(v => (
              <div key={v.name} className="grid gap-2">
                <label className="text-sm font-medium">
                  {v.name} {v.required && <span className="text-destructive">*</span>}
                </label>
                <Input 
                  value={scriptParams[v.name] || ""} 
                  onChange={e => setScriptParams({ ...scriptParams, [v.name]: e.target.value })} 
                  placeholder={v.default_value}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter className={cn(!selectedScript || selectedScript.vars.length === 0 ? "mt-4" : "")}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button 
            onClick={() => selectedScript && onRun(selectedScript, scriptParams)}
            disabled={!selectedScript || selectedScript.vars.some(v => v.required && !scriptParams[v.name])}
          >
            执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

