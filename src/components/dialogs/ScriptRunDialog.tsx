import { Script } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface Props {
  selectedScript: Script | null;
  onOpenChange: (open: boolean) => void;
  scriptParams: Record<string, string>;
  setScriptParams: (p: Record<string, string>) => void;
  onRun: (script: Script, params: Record<string, string>) => void;
}

export default function ScriptRunDialog({ selectedScript, onOpenChange, scriptParams, setScriptParams, onRun }: Props) {
  return (
    <Dialog open={!!selectedScript} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{selectedScript?.name}</DialogTitle>
          <DialogDescription>配置脚本参数并执行。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto px-1">
          {selectedScript?.vars.map(v => (
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button 
            onClick={() => selectedScript && onRun(selectedScript, scriptParams)}
            disabled={selectedScript?.vars.some(v => v.required && !scriptParams[v.name] && !v.default_value)}
          >
            执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
