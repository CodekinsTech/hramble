#!/bin/bash
# Install Hramble's memory harness into OpenCode: the notes protocol + the
# remember/recall plugin (memory baked into the engine, Claude-style).
set -e
DEST="$HOME/.config/opencode"
mkdir -p "$DEST/plugin"
cp "$(dirname "$0")/../opencode-plugins/hramble-memory.js" "$DEST/plugin/hramble-memory.js"
cp "$(dirname "$0")/../docs/memory-harness.md" "$DEST/memory-harness.md"
echo "Installed memory plugin + harness. Add to ~/.config/opencode/opencode.jsonc:"
echo '  "plugin": ["'"$DEST"'/plugin/hramble-memory.js"],'
echo '  "instructions": ["'"$DEST"'/memory-harness.md"]'
echo "Then restart OpenCode. The remember/recall tools will be available."
