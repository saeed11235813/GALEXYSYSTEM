#!/usr/bin/env bash
# Agency HQ installer for Ubuntu. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/saeed11235813/GALEXYSYSTEM/claude/intelligent-mccarthy-11sbxr/server/install.sh | bash
# Safe to run again: it updates the code and keeps your settings.
set -euo pipefail

REPO="https://github.com/saeed11235813/GALEXYSYSTEM.git"
BRANCH="${BRANCH:-claude/intelligent-mccarthy-11sbxr}"
APP=/opt/agency-hq
ENVF=/etc/agency-hq.env
SVC=agency-hq
PORT="${PORT:-8080}"

[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates openssl >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "==> Installing Claude Code"
npm install -g --silent @anthropic-ai/claude-code
CLAUDE_BIN="$(command -v claude)"

id agency >/dev/null 2>&1 || useradd -m -s /bin/bash agency

echo "==> Fetching Agency HQ"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$APP"
fi
mkdir -p "$APP/workspaces"
chown -R agency:agency "$APP"

if [ ! -f "$ENVF" ]; then
  cat > "$ENVF" <<EOF
# Agency HQ settings. Restart after editing: systemctl restart $SVC
# Password for the web page (keep it secret):
ACCESS_TOKEN=$(openssl rand -hex 16)
PORT=$PORT
# How many agents may work at the same time (keeps your subscription limits safe):
MAX_JOBS=2
# Set to 1 to let agents run shell commands on this server (riskier):
ALLOW_BASH=0
CLAUDE_BIN=$CLAUDE_BIN
# Paste the token printed by:  sudo -u agency claude setup-token
CLAUDE_CODE_OAUTH_TOKEN=
EOF
  chmod 600 "$ENVF"
fi

cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Agency HQ (agents powered by Claude Code)
After=network-online.target

[Service]
User=agency
WorkingDirectory=$APP
EnvironmentFile=$ENVF
Environment=HOME=/home/agency
ExecStart=$(command -v node) $APP/server/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q $SVC
systemctl restart $SVC

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT/tcp" >/dev/null; fi

IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
TOKEN="$(grep '^ACCESS_TOKEN=' "$ENVF" | cut -d= -f2)"
echo
echo "=============================================================="
echo " Agency HQ is installed:  http://$IP:$PORT"
echo " Page password (ACCESS_TOKEN): $TOKEN"
echo
if ! grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.\+' "$ENVF"; then
  echo " Last step: connect your Claude account (subscription, not API):"
  echo "   1) sudo -u agency claude setup-token"
  echo "      (open the link it prints, sign in, paste the code back)"
  echo "   2) put the token it prints into $ENVF after CLAUDE_CODE_OAUTH_TOKEN="
  echo "   3) systemctl restart $SVC"
fi
echo "=============================================================="
