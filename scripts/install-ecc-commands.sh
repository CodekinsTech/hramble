#!/bin/bash
# Install a curated set of ECC slash commands into OpenCode.
#
# ECC (https://github.com/affaan-m/ECC, MIT) is a large agent-harness toolkit.
# Installing all of it is risky (its own docs need a build step + modify your
# home config, and heavy skill/rule context can degrade weak local models).
# So this installs only the SELF-CONTAINED, high-value slash commands, with each
# command's custom agent rewritten to the standard `build` agent so they work
# without ECC's full agent set. They appear in the chat's `/` picker.
#
# Reversible: delete ~/.config/opencode/command/ecc-*.md to remove them.

set -e
DEST="$HOME/.config/opencode/command"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Cloning ECC…"
git clone --depth 1 https://github.com/affaan-m/ECC.git "$TMP/ECC" >/dev/null 2>&1
CMDS="$TMP/ECC/.opencode/commands"

mkdir -p "$DEST"
# Curated generic commands (skip ECC-internal ones: instinct/harness/loop/evolve/…).
for name in verify checkpoint code-review security refactor-clean tdd test-coverage model-route e2e build-fix; do
  src="$CMDS/$name.md"
  [ -f "$src" ] || continue
  sed -E 's/^agent: .*/agent: build/' "$src" > "$DEST/ecc-$name.md"
  echo "  installed ecc-$name"
done

echo "Done. Restart OpenCode (or Hramble) to pick up the new /ecc-* commands."
