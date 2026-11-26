#!/bin/sh
# Keeper auto-update for the Synology.
# Checks GitHub for a newer version of Keeper; if there is one, downloads it, keeps .env and data/,
# and rebuilds the containers. Does nothing when already up to date.
#
# Set up once in DSM: Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script
#   User: root · Schedule: daily, every 15 minutes · Script:
#   sh /volume1/docker/keeper/update.sh
# Press "Run" on that task any time to update right away. Log: /volume1/docker/keeper/update.log

REPO="nickmackenzie1/keeper"
BRANCH="main"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/update.log"
STAMP="$DIR/.deployed"
LOCK="/tmp/keeper-update.lock"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

log() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$LOG"; }

# One update at a time.
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rmdir "$LOCK"' EXIT

# Keep the log short.
[ -f "$LOG" ] && tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

LATEST=$(curl -fsS --max-time 20 "https://api.github.com/repos/$REPO/commits/$BRANCH" \
  -H "Accept: application/vnd.github.sha" 2>/dev/null)
case "$LATEST" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) log "couldn't reach GitHub, will try again later"; exit 0 ;;
esac

CURRENT=$(cat "$STAMP" 2>/dev/null)
[ "$LATEST" = "$CURRENT" ] && [ "$1" != "--force" ] && exit 0

SHORT=$(echo "$LATEST" | cut -c1-7)
log "updating to $SHORT"

TMP=$(mktemp -d)
if ! curl -fsSL --max-time 300 "https://codeload.github.com/$REPO/tar.gz/$LATEST" | tar -xz -C "$TMP" --strip-components=1; then
  log "download failed"; rm -rf "$TMP"; exit 1
fi
# .env and data/ are never in GitHub, so copying over the folder leaves them alone.
cp -a "$TMP/." "$DIR/"
rm -rf "$TMP"

# Use the same project name Container Manager gave the running containers, so it stays one project.
PROJECT=$(docker inspect keeper --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
[ -z "$PROJECT" ] && PROJECT="keeper"

if docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"; else COMPOSE="docker-compose"; fi

cd "$DIR" || exit 1
if KEEPER_VERSION="$SHORT" $COMPOSE -p "$PROJECT" up -d --build >> "$LOG" 2>&1; then
  echo "$LATEST" > "$STAMP"
  docker image prune -f >/dev/null 2>&1
  log "done — running $SHORT"
else
  log "BUILD FAILED — Keeper keeps running the previous version. Send the lines above to Claude."
  exit 1
fi
