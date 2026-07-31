#!/bin/bash
# Hramble dev launcher — run by the Hramble.app icon on the Desktop, which
# opens Terminal and executes this script.
#
# It runs the dev server in the FOREGROUND on purpose: Terminal must own the
# process. Backgrounding it from an AppleScript applet does not work — macOS
# sends SIGTERM ("Polite quit request") to the applet's children when the
# applet exits, killing the dev server seconds after launch.
#
# GUI launches don't inherit the shell PATH, so absolute paths are used.

APP_DIR="/Users/nishan/Desktop/code2/hramble code/app"
BUN="/Users/nishan/.bun/bin/bun"
LOG="$HOME/Library/Logs/hramble-dev.log"

# "Already running" is decided by the DEV SERVER, not by Electron.
#
# Electron alive + dev server dead = a ZOMBIE: it shows Electron's default
# welcome screen with no app loaded. Keying the guard off Electron made the
# launcher "focus" that zombie forever instead of starting the real app.
if pgrep -f "hramble code/app/node_modules/.bin/electron-vite" >/dev/null 2>&1 \
  || pgrep -f "hramble code/app/node_modules/turbo" >/dev/null 2>&1; then
  echo "Hramble is already running — bringing it to the front."
  osascript -e 'tell application "Electron" to activate' >/dev/null 2>&1
  sleep 1
  exit 0
fi

# No dev server → anything Electron-ish still alive is a leftover zombie.
# Clear it, plus any stale OpenCode holding the port, before starting clean.
pkill -9 -f "hramble code/app/node_modules/electron" >/dev/null 2>&1
pkill -f "opencode serve" >/dev/null 2>&1
sleep 1

mkdir -p "$(dirname "$LOG")"
cd "$APP_DIR" || { echo "Cannot find $APP_DIR"; exit 1; }

echo "Starting Hramble… (first build takes ~60s)"
echo "Keep this window open — closing it stops the app."
echo

"$BUN" run dev --filter=@hramble/desktop 2>&1 | tee "$LOG"
