#!/bin/bash

DEST_DIR="/mnt/d/workspace/remoter"

echo "Navigating to Windows directory: $DEST_DIR"
cd "$DEST_DIR" || exit 1

echo "Installing dependencies and compiling using Windows toolchain..."
# Invoke powershell.exe to execute the Windows toolchain natively
# 'D:\workspace\remoter' corresponds to '/mnt/d/workspace/remoter'
powershell.exe -Command "cd 'D:\workspace\remoter'; pnpm install; pnpm tauri build"

echo "Build process finished."
echo "You can find the output in $DEST_DIR/src-tauri/target/release/bundle/"
