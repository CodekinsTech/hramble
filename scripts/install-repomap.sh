#!/bin/bash
# Install Hramble's repo-map plugin into OpenCode: registers the `repo_map`
# tool that gives the model a compact codebase symbol map (aider-style) in one
# call — no tree-sitter, no build step, language-agnostic.
set -e
DEST="$HOME/.config/opencode"
mkdir -p "$DEST/plugin"
cp "$(dirname "$0")/../opencode-plugins/hramble-repomap.js" "$DEST/plugin/hramble-repomap.js"
echo "Installed repo-map plugin. Add to ~/.config/opencode/opencode.jsonc plugin array:"
echo '  "'"$DEST"'/plugin/hramble-repomap.js"'
echo "Then restart OpenCode. The repo_map tool will be available."
