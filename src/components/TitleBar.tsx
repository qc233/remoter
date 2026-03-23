import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Copy } from "lucide-react";

const appWindow = getCurrentWindow();

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    
    const updateMaximized = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };
    
    updateMaximized();
    
    const setupListener = async () => {
      unlistenFn = await appWindow.onResized(() => {
        updateMaximized();
      });
    };
    setupListener();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  const handleClose = () => appWindow.close();

  const handleDrag = async () => {
    await appWindow.startDragging();
  };

  return (
    <div 
      data-tauri-drag-region 
      onPointerDown={handleDrag}
      className="h-10 flex items-center justify-between bg-card border-b border-border select-none cursor-default"
    >
      <div className="flex items-center gap-2 px-4 pointer-events-none">
        <div className="w-4 h-4 rounded-sm bg-primary/20 flex items-center justify-center">
            <div className="w-2 h-2 rounded-[1px] bg-primary" />
        </div>
        <span className="text-xs font-medium text-muted-foreground tracking-wider">REMOTER</span>
      </div>

      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="flex items-center justify-center w-12 h-full hover:bg-muted transition-colors"
          title="Minimize"
        >
          <Minus size={14} className="text-muted-foreground" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex items-center justify-center w-12 h-full hover:bg-muted transition-colors"
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Copy size={12} className="text-muted-foreground" />
          ) : (
            <Square size={12} className="text-muted-foreground" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="flex items-center justify-center w-12 h-full hover:bg-destructive hover:text-destructive-foreground transition-colors group"
          title="Close"
        >
          <X size={14} className="text-muted-foreground group-hover:text-current" />
        </button>
      </div>
    </div>
  );
}
