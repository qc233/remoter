#!/bin/bash

# Define source and destination
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/"
DEST_DIR="/mnt/d/workspace/remoter/"

echo "Syncing project to Windows directory: $DEST_DIR"

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Use rsync to sync files, excluding generated and git directories
rsync -av --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'src-tauri/target' \
    --exclude '.git' \
    --exclude '.github' \
    --exclude '.agent' \
    "$SRC_DIR" "$DEST_DIR"

echo "Sync complete."

# Execute the build script
echo "Starting compilation on Windows..."
bash "$(dirname "$0")/build_on_windows.sh"
