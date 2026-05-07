import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardFooter, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  activePage: string;
}

export default function SettingsPage({ activePage }: Props) {
  const [maxConcurrency, setMaxConcurrency] = useState(10);

  useEffect(() => {
    invoke<{ theme?: string; max_concurrency: number }>("get_settings").then(settings => {
      setMaxConcurrency(settings.max_concurrency || 10);
    });
  }, []);

  const handleSaveConcurrency = async (value: number) => {
    const v = Math.max(1, value);
    setMaxConcurrency(v);
    await invoke("set_max_concurrency", { value: v });
  };

  return (
    <div 
      className={cn(
        "absolute inset-0 p-6 overflow-auto transition-opacity duration-300",
        activePage === 'settings' ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
      )}
    >
      <h2 className="text-2xl font-bold mb-6">设置</h2>
      
      <div className="flex flex-col gap-4">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>并发控制</CardTitle>
            <CardDescription>FORK 页面执行命令分发时的最大并发连接数。较小的值可以减轻目标服务器的压力。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input 
                type="number" 
                min={1} 
                max={100}
                value={maxConcurrency} 
                onChange={e => {
                  const v = parseInt(e.target.value) || 1;
                  setMaxConcurrency(v);
                }}
                onBlur={() => handleSaveConcurrency(maxConcurrency)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveConcurrency(maxConcurrency); }}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">个并发连接</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>持久化存储</CardTitle>
            <CardDescription>所有数据保存在 ~/.config/remoter/config.json 文件中 (明文)。</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => invoke("manual_save_to_disk")}>强制保存</Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
