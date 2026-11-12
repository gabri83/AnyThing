#!/usr/bin/env bash
#
# Install AnyThing on this Mac:
#
#   curl -fsSL https://raw.githubusercontent.com/gabri83/AnyThing/main/install.sh | bash
#
# It fetches AnyThing into ~/.anything/app, builds it, puts an `anything`
# command on your PATH and starts the host in the background (and at every
# login). Run it again, or `anything update`, to update. Nothing needs sudo.
#
#   ./install.sh --here        use the checkout this script is in (for development)
#   ./install.sh --uninstall   stop the host and remove the command and the app
#
# Settings, by environment variable:
#   ANYTHING_HOME        where the app goes          (default ~/.anything/app)
#   ANYTHING_REF         branch or tag to install    (default main)
#   ANYTHING_REPO        repository to fetch         (default the official one)
#   ANYTHING_BIN_DIR     where the command is linked (default: a writable PATH folder)
#   ANYTHING_NO_SERVICE  set to 1 to not start the host in the background

set -euo pipefail

# Everything is inside main, called on the last line, so a download that is cut
# short cannot run half a script.
main() {
  local repo="${ANYTHING_REPO:-https://github.com/gabri83/AnyThing.git}"
  local ref="${ANYTHING_REF:-main}"
  local app="${ANYTHING_HOME:-$HOME/.anything/app}"
  local mode="fetch"

  case "${1:-}" in
    "") ;;
    --here) mode="here" ;;
    --uninstall) mode="uninstall" ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; return 0 ;;
    *) fail "Unknown option: $1 (try --help)" ;;
  esac

  if [ "$mode" = "here" ]; then
    app="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    [ -f "$app/server/package.json" ] || fail "--here must be run from an AnyThing checkout"
  fi

  if [ "$mode" = "uninstall" ]; then
    uninstall "$app"
    return 0
  fi

  say "Checking what is needed"
  command -v git >/dev/null 2>&1 || fail "git is missing. Install the Xcode command line tools: xcode-select --install"
  command -v node >/dev/null 2>&1 || fail "Node.js is missing. Install it from https://nodejs.org or with: brew install node"
  command -v npm >/dev/null 2>&1 || fail "npm is missing; it normally comes with Node.js"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 18 ] || fail "Node.js 18 or newer is needed; this is $(node -v)"

  if [ "$mode" = "fetch" ]; then
    if [ -d "$app/.git" ]; then
      say "Updating $app to $ref"
      # This folder is the installer's, but never throw away somebody's edits.
      if [ -n "$(git -C "$app" status --porcelain)" ]; then
        fail "$app has local changes. Commit or discard them, or use ./install.sh --here from that folder."
      fi
      git -C "$app" fetch --quiet --depth 1 origin "$ref"
      git -C "$app" checkout --quiet --detach FETCH_HEAD
    elif [ -e "$app" ]; then
      fail "$app exists and is not an AnyThing install. Move it away or set ANYTHING_HOME."
    else
      say "Fetching AnyThing ($ref) into $app"
      mkdir -p "$(dirname "$app")"
      git clone --quiet --depth 1 --branch "$ref" -- "$repo" "$app"
    fi
  fi

  say "Installing dependencies"
  (cd "$app" && { npm ci --no-audit --no-fund --loglevel=error || npm install --no-audit --no-fund --loglevel=error; })

  say "Building"
  (cd "$app" && npm run build --silent)
  chmod +x "$app/server/dist/cli.js"

  local bin
  bin="$(bin_dir)"
  mkdir -p "$bin"
  ln -sf "$app/server/dist/cli.js" "$bin/anything"
  say "Linked the anything command into $bin"

  if [ "${ANYTHING_NO_SERVICE:-0}" = "1" ]; then
    say "Not starting the host in the background (ANYTHING_NO_SERVICE=1)"
  elif [ "$(uname -s)" = "Darwin" ]; then
    say "Starting the host in the background"
    "$bin/anything" service install
  else
    say "Background start is set up for macOS only; run: anything start"
  fi

  echo
  echo "AnyThing is installed."
  echo
  echo "  Plug in a Car Thing running Bridgething and it appears on its screen."
  echo "  anything url       a link to try it in a browser instead"
  echo "  anything status    what is running"
  echo "  anything help      everything else"
  case ":$PATH:" in
    *":$bin:"*) ;;
    *)
      echo
      echo "  $bin is not on your PATH. Add this line to ~/.zshrc and open a new terminal:"
      echo "    export PATH=\"$bin:\$PATH\""
      ;;
  esac
}

say() { printf '==> %s\n' "$*"; }
fail() { printf 'AnyThing install: %s\n' "$*" >&2; exit 1; }

# The first folder that is already on PATH and writable, so the command works
# straight away without sudo; ~/.local/bin otherwise.
bin_dir() {
  if [ -n "${ANYTHING_BIN_DIR:-}" ]; then
    echo "$ANYTHING_BIN_DIR"
    return
  fi
  local candidate
  for candidate in "$HOME/.local/bin" /usr/local/bin /opt/homebrew/bin; do
    case ":$PATH:" in
      *":$candidate:"*)
        if [ -d "$candidate" ] && [ -w "$candidate" ]; then
          echo "$candidate"
          return
        fi
        ;;
    esac
  done
  echo "$HOME/.local/bin"
}

uninstall() {
  local app="$1" candidate
  if [ "$(uname -s)" = "Darwin" ] && [ -x "$app/server/dist/cli.js" ]; then
    say "Stopping the host"
    "$app/server/dist/cli.js" service uninstall || true
  fi
  for candidate in "${ANYTHING_BIN_DIR:-}" "$HOME/.local/bin" /usr/local/bin /opt/homebrew/bin; do
    # Only remove a link that points at this install.
    if [ -n "$candidate" ] && [ "$(readlink "$candidate/anything" 2>/dev/null || true)" = "$app/server/dist/cli.js" ]; then
      rm -f "$candidate/anything"
      say "Removed $candidate/anything"
    fi
  done
  if [ -d "$app/.git" ] && [ "$app" = "${ANYTHING_HOME:-$HOME/.anything/app}" ]; then
    rm -rf "$app"
    say "Removed $app"
  fi
  echo "AnyThing is uninstalled. Your settings and plugins are still in ~/.anything"
}

main "$@"
