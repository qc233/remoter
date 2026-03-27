import { Script } from "@/types";
import { Button } from "@/components/ui/button";
import { Plus, Settings } from "lucide-react";

interface Props {
  scripts: Script[];
  onRunScript: (script: Script) => void;
  onManageScripts: () => void;
  onNewScript: () => void;
}

export default function ScriptSidebar({ scripts, onRunScript, onManageScripts, onNewScript }: Props) {
  return (
    <aside className="w-64 border-l border-border bg-card/40 backdrop-blur-md flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between px-2 mb-2">
        <h3 className="font-semibold">快捷脚本</h3>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6"
          onClick={onManageScripts}
        >
          <Settings size={14} />
        </Button>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {scripts.map(script => (
          <Button 
            key={script.id} 
            variant="outline" 
            className="justify-start h-auto py-3 px-4 text-left font-normal bg-card/40 hover:bg-accent/10 hover:border-primary transition-all duration-200 group active:scale-[0.98]"
            onClick={() => onRunScript(script)}
          >
            <div className="flex flex-col gap-0.5 w-full overflow-hidden min-w-0 flex-1">
              <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">{script.name}</span>
              <span className="text-[10px] text-muted-foreground truncate opacity-70 font-mono group-hover:opacity-100 transition-opacity">{script.command_template}</span>
            </div>
          </Button>
        ))}
        <Button 
          variant="ghost" 
          className="mt-2 border border-dashed border-border"
          onClick={onNewScript}
        >
          <Plus size={14} className="mr-2" /> 新建脚本
        </Button>
      </div>
    </aside>
  );
}
