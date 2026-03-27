import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  activePage: string;
}

export default function SettingsPage({ activePage }: Props) {
  return (
    <div 
      className={cn(
        "absolute inset-0 p-6 overflow-auto transition-opacity duration-300",
        activePage === 'settings' ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
      )}
    >
      <h2 className="text-2xl font-bold mb-6">设置</h2>
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
  );
}
