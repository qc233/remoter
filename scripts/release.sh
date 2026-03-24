#!/bin/bash

# Exit on error
set -e

# Detect platform and architecture
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Read version from package.json
VERSION=$(grep '"version":' package.json | head -1 | cut -d '"' -f 4)
PRODUCT_NAME=$(grep '"productName":' src-tauri/tauri.conf.json | head -1 | cut -d '"' -f 4)
if [ -z "$PRODUCT_NAME" ]; then
    PRODUCT_NAME="remoter"
fi

echo "Starting release process for $PRODUCT_NAME v$VERSION on $PLATFORM ($ARCH)..."

# Ensure pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed."
    exit 1
fi

# Ensure dependencies are up to date
echo "Updating dependencies..."
pnpm install

# Build the application
echo "Building the application for $PLATFORM..."
pnpm tauri build

# Define the release directory
RELEASE_DIR="releases/v$VERSION/$PLATFORM-$ARCH"
mkdir -p "$RELEASE_DIR"

echo "Collecting artifacts into $RELEASE_DIR..."

# 1. Collect standard bundles
# Find and copy all bundle files
# Linux: .AppImage, .deb, .rpm
# Windows: .msi, .exe
# macOS: .dmg, .app
find src-tauri/target/release/bundle -type f \( -name "*.AppImage" -o -name "*.deb" -o -name "*.msi" -o -name "*.exe" -o -name "*.dmg" -o -name "*.zip" \) -exec cp {} "$RELEASE_DIR/" \;

# 2. Package Generic Binary (for Linux)
if [ "$PLATFORM" == "linux" ]; then
    EXECUTABLE="src-tauri/target/release/$PRODUCT_NAME"
    if [ -f "$EXECUTABLE" ]; then
        echo "Packaging generic binary for Linux..."
        TARBALL_NAME="${PRODUCT_NAME}_${VERSION}_linux_${ARCH}.tar.gz"
        # Create a temporary directory for the tarball structure
        TEMP_TAR_DIR=$(mktemp -d)
        cp "$EXECUTABLE" "$TEMP_TAR_DIR/"
        # Add a basic README if you want, or just the binary
        tar -czf "$RELEASE_DIR/$TARBALL_NAME" -C "$TEMP_TAR_DIR" .
        rm -rf "$TEMP_TAR_DIR"
        echo "Created generic binary tarball: $TARBALL_NAME"
    fi
fi

# 3. For Windows, also ensure the .exe is copied if not bundled
if [[ "$PLATFORM" == "mingw"* ]] || [[ "$PLATFORM" == "cygwin"* ]] || [[ "$PLATFORM" == "msys"* ]]; then
    EXE_FILE="src-tauri/target/release/${PRODUCT_NAME}.exe"
    if [ -f "$EXE_FILE" ] && [ ! -f "$RELEASE_DIR/${PRODUCT_NAME}.exe" ]; then
        cp "$EXE_FILE" "$RELEASE_DIR/"
    fi
fi

echo "----------------------------------------"
echo "Release v$VERSION for $PLATFORM-$ARCH is ready!"
echo "Artifacts are located in: $RELEASE_DIR"
ls -lh "$RELEASE_DIR"
