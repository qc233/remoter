import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { File, Folder, ChevronLeft, RefreshCw, X, Download, Upload, Trash2, Plus, HardDrive } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface SftpFile {
  name: string;
  size: number;
  is_dir: boolean;
  is_file: boolean;
  permissions?: number;
  modified?: number;
}

interface Props {
  sessionId: string;
  currentPath: string;
  onPathChange: (path: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function SFTPDrawer({ sessionId, currentPath, onPathChange, isOpen, onClose }: Props) {
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPath, setEditPath] = useState(currentPath);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const fetchFiles = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<SftpFile[]>('sftp_list', { sessionId, path });
      // Sort: directories first, then files, both alphabetically
      const sorted = result.sort((a, b) => {
        if (a.is_dir === b.is_dir) {
          return a.name.localeCompare(b.name);
        }
        return a.is_dir ? -1 : 1;
      });
      setFiles(sorted);
    } catch (err) {
      console.error('SFTP list error:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (isOpen && currentPath) {
      fetchFiles(currentPath);
      setEditPath(currentPath);
    }
  }, [isOpen, currentPath, fetchFiles]);

  const handleDirClick = (name: string) => {
    let newPath = currentPath;
    if (!newPath.endsWith('/')) newPath += '/';
    newPath += name;
    onPathChange(newPath);
  };

  const handleBack = () => {
    if (currentPath === '/' || !currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const newPath = '/' + parts.join('/');
    onPathChange(newPath || '/');
  };

  const handleManualPath = () => {
    onPathChange(editPath || '/');
    setIsEditingPath(false);
  };

  const handleDownload = async (file: SftpFile) => {
    if (file.is_dir) return;
    try {
      setLoading(true);
      const remotePath = currentPath.endsWith('/') ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
      const data = await invoke<number[]>('sftp_download', { sessionId, remotePath });
      
      // Create a blob and download it
      const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert(`Download failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    setLoading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        const contentPromise = new Promise<ArrayBuffer>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
        });
        reader.readAsArrayBuffer(file);
        const content = await contentPromise;
        
        const remotePath = currentPath.endsWith('/') ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
        await invoke('sftp_upload', {
          sessionId,
          remotePath,
          data: Array.from(new Uint8Array(content))
        });
      }
      fetchFiles(currentPath);
    } catch (err) {
      console.error('Upload error:', err);
      alert(`Upload failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  const onDragStart = (e: React.DragEvent, file: SftpFile) => {
    // For "drag out", we can't easily drag to OS desktop without complex plugins,
    // but we can set some data for dragging into the terminal etc.
    e.dataTransfer.setData('text/plain', file.name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className={cn(
            "absolute top-0 left-[2.5%] right-[2.5%] z-50 bg-card border-x border-b border-border shadow-xl overflow-hidden flex flex-col max-h-[60%] rounded-b-xl",
            isDraggingOver && "ring-2 ring-primary ring-inset bg-primary/5"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={onDrop}
        >
          <div className="flex items-center justify-between p-2 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2 overflow-hidden flex-1 px-1">
              <HardDrive size={14} className="text-primary shrink-0" />
              
              {isEditingPath ? (
                <input 
                  autoFocus
                  className="flex-1 bg-background border border-primary/30 rounded px-2 py-0.5 text-xs font-mono outline-none focus:ring-1 focus:ring-primary/50"
                  value={editPath}
                  onChange={e => setEditPath(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleManualPath();
                    if (e.key === 'Escape') setIsEditingPath(false);
                  }}
                  onBlur={handleManualPath}
                />
              ) : (
                <div 
                  className="flex items-center gap-1 overflow-hidden font-mono text-xs cursor-text hover:bg-muted p-1 rounded transition-colors flex-1"
                  onClick={() => setIsEditingPath(true)}
                >
                  {currentPath.split('/').filter(Boolean).length === 0 ? (
                    <span className="opacity-40">/</span>
                  ) : (
                    currentPath.split('/').filter(Boolean).map((part, i, arr) => (
                      <React.Fragment key={i}>
                        <span className="opacity-40">/</span>
                        <span className="truncate">{part}</span>
                      </React.Fragment>
                    ))
                  )}
                  <span className="ml-2 w-1.5 h-1.5 rounded-full bg-green-500/80 animate-pulse shrink-0" title="Auto-tracking path via shell integration" />
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleBack} disabled={currentPath === '/'}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fetchFiles(currentPath)} disabled={loading}>
                <RefreshCw size={12} className={cn(loading && "animate-spin")} />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive" onClick={onClose}>
                <X size={16} />
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-2">
            {error ? (
              <div className="p-8 text-center text-destructive flex flex-col items-center gap-2">
                <X size={48} className="opacity-20" />
                <p className="text-sm font-medium">无法读取目录</p>
                <p className="text-xs opacity-70">{error}</p>
              </div>
            ) : files.length === 0 && !loading ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Folder size={48} className="opacity-10" />
                <p className="text-sm italic">目录为空 (或拖入文件上传)</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                {files.map((file) => (
                  <div
                    key={file.name}
                    draggable={!file.is_dir}
                    onDragStart={(e) => onDragStart(e, file)}
                    onClick={() => file.is_dir ? handleDirClick(file.name) : null}
                    className={cn(
                      "group flex items-center gap-3 p-2 rounded-md transition-all cursor-pointer border border-transparent relative",
                      file.is_dir ? "hover:bg-primary/10 hover:border-primary/20" : "hover:bg-muted"
                    )}
                  >
                    <div className={cn(
                      "shrink-0 w-8 h-8 flex items-center justify-center rounded",
                      file.is_dir ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted"
                    )}>
                      {file.is_dir ? <Folder size={18} /> : <File size={18} />}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span className="text-xs font-medium truncate">{file.name}</span>
                      {!file.is_dir && <span className="text-[10px] text-muted-foreground">{formatSize(file.size)}</span>}
                    </div>
                    
                    {!file.is_dir && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-sm"
                        onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                      >
                        <Download size={12} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="p-2 border-t border-border bg-muted/10 flex justify-end gap-2">
            <input 
              type="file" 
              id="sftp-upload-input" 
              className="hidden" 
              multiple 
              onChange={(e) => e.target.files && handleFileUpload(e.target.files)} 
            />
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-[10px] gap-1"
              onClick={() => document.getElementById('sftp-upload-input')?.click()}
            >
              <Upload size={12} /> 上传文件
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
