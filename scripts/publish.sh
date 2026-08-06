#!/usr/bin/env bash

set -Eeuo pipefail

die() {
  echo "Error: $*" >&2
  exit 1
}

step() {
  echo
  echo "==> $*"
}

usage() {
  cat <<'EOF'
Usage: pnpm publish:new [patch|minor|major|VERSION]

Examples:
  pnpm publish:new          # 0.1.6 -> 0.1.7
  pnpm publish:new minor    # 0.1.6 -> 0.2.0
  pnpm publish:new 1.0.0
EOF
}

[[ ${1:-} != "-h" && ${1:-} != "--help" ]] || { usage; exit 0; }
[[ $# -le 1 ]] || { usage >&2; exit 2; }

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a Git repository"
cd "$ROOT"

for command_name in git node pnpm cargo; do
  command -v "$command_name" >/dev/null 2>&1 || die "$command_name is required"
done

[[ -z $(git status --porcelain) ]] || die "working tree is not clean; commit or stash changes first"

BRANCH=$(git symbolic-ref --quiet --short HEAD) || die "detached HEAD cannot be published"
git remote get-url origin >/dev/null 2>&1 || die "Git remote 'origin' is not configured"

CURRENT_VERSION=$(node -p "require('./package.json').version")
TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
CARGO_VERSION=$(sed -n '/^\[package\]/,/^\[/s/^version = "\([^"]*\)"/\1/p' src-tauri/Cargo.toml | head -n 1)
[[ $CURRENT_VERSION == "$TAURI_VERSION" && $CURRENT_VERSION == "$CARGO_VERSION" ]] || \
  die "version mismatch: package=$CURRENT_VERSION, tauri=$TAURI_VERSION, cargo=$CARGO_VERSION"
[[ $CURRENT_VERSION =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "current version is not SemVer: $CURRENT_VERSION"

case ${1:-patch} in
  patch) NEXT_VERSION="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))" ;;
  minor) NEXT_VERSION="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] + 1)).0" ;;
  major) NEXT_VERSION="$((BASH_REMATCH[1] + 1)).0.0" ;;
  v[0-9]*|[0-9]*) NEXT_VERSION=${1#v} ;;
  *) die "expected patch, minor, major, or an explicit version" ;;
esac
[[ $NEXT_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || die "invalid version: $NEXT_VERSION"
[[ $NEXT_VERSION != "$CURRENT_VERSION" ]] || die "new version equals current version"

step "Checking remote state"
git fetch --quiet origin "$BRANCH" --tags
UPSTREAM="origin/$BRANCH"
git rev-parse --verify "$UPSTREAM" >/dev/null 2>&1 || die "$UPSTREAM does not exist"
[[ $(git rev-list --count "HEAD..$UPSTREAM") -eq 0 ]] || die "local branch is behind $UPSTREAM; update it first"
git rev-parse --verify --quiet "refs/tags/v$NEXT_VERSION" >/dev/null && die "tag v$NEXT_VERSION already exists"

step "Scanning tracked files for secrets"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git "$ROOT" --redact --no-banner
else
  echo "gitleaks not found; using the built-in conservative scanner"
  SECRET_FILES=$(git ls-files | grep -Ei '(^|/)(id_(rsa|dsa|ecdsa|ed25519)|.*\.(pem|p12|pfx|key|keystore))$' || true)
  SECRET_PATTERN="(-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[0-9A-Za-z]{36,255}|sk-(proj-)?[0-9A-Za-z_-]{20,}|(password|passwd|secret|api[_-]?key|access[_-]?token)[[:space:]]*[:=][[:space:]]*[\"'][^\"']{8,}[\"'])"
  SECRET_CONTENT=$(git grep -IlE "$SECRET_PATTERN" \
    -- . ':!pnpm-lock.yaml' ':!src-tauri/Cargo.lock' || true)
  if [[ -n $SECRET_FILES || -n $SECRET_CONTENT ]]; then
    echo "Possible secret material found in:" >&2
    printf '%s\n%s\n' "$SECRET_FILES" "$SECRET_CONTENT" | sed '/^$/d' | sort -u >&2
    die "secret scan failed (install gitleaks for a stronger scan)"
  fi
fi

step "Running available tests"
if node -e "const s=require('./package.json').scripts||{}; process.exit(s.test ? 0 : 1)"; then
  pnpm test
else
  echo "No package.json test script; skipping frontend tests"
fi
cargo test --manifest-path src-tauri/Cargo.toml --locked

step "Checking production frontend build"
pnpm build

step "Updating version $CURRENT_VERSION -> $NEXT_VERSION"
NEXT_VERSION="$NEXT_VERSION" node -e '
const fs = require("fs");
for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  json.version = process.env.NEXT_VERSION;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
}'
NEXT_VERSION="$NEXT_VERSION" perl -0pi -e \
  's/(\[package\]\s+name = "remoter"\s+version = ")[^"]+/$1$ENV{NEXT_VERSION}/' \
  src-tauri/Cargo.toml src-tauri/Cargo.lock

cargo metadata --manifest-path src-tauri/Cargo.toml --locked --no-deps >/dev/null
git diff --check

step "Committing and tagging v$NEXT_VERSION"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore(release): v$NEXT_VERSION"
git tag -a "v$NEXT_VERSION" -m "Release v$NEXT_VERSION"

step "Pushing branch and tag atomically"
git push --atomic origin "HEAD:$BRANCH" "refs/tags/v$NEXT_VERSION"

echo
echo "Published v$NEXT_VERSION to origin/$BRANCH"
