#!/bin/bash
# Wrapper for next dev that:
# 1. Sets BROWSER=none to prevent the dock icon (Next.js auto-opens a browser
#    which causes macOS to register the node process as a GUI app)
# 2. Kills all child processes when this script exits, preventing lingering
#    next-server processes after the dev server is shut down

cleanup() {
    kill -- -$$ 2>/dev/null
    kill $(jobs -p) 2>/dev/null
    exit
}
trap cleanup SIGTERM SIGINT EXIT

export BROWSER=none
cd "$(dirname "$0")/.."
PATH=/usr/local/bin:$PATH npm run dev &
wait
