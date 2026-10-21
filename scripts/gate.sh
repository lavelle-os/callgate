#!/usr/bin/env bash
# Publishing gate. Run before every commit on any Lavelle repo:  scripts/gate.sh
# 1) If gitleaks is installed, it scans the STAGED files and blocks on any finding. That is the real check.
# 2) A small regex fallback runs either way, for phones, paths, keys, and a private names list.
# Neither replaces a human reading the files and PUBLIC-IDENTITY.md. A grep is not anonymity.
set -euo pipefail
FILES=$(git diff --cached --name-only --diff-filter=ACM || true)
[ -z "$FILES" ] && { echo "gate: nothing staged"; exit 0; }

fail=0
export PATH="$HOME/.local/bin:$PATH"
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks protect --staged --no-banner --redact >/tmp/gate-gitleaks.txt 2>&1; then
    echo "gate: BLOCKED by gitleaks (staged secrets). Details: /tmp/gate-gitleaks.txt"; fail=1
  fi
else
  echo "gate: note — gitleaks not installed (brew install gitleaks); regex fallback only"
fi

PATTERN='(\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4})|/Users/[A-Za-z]+|/home/[A-Za-z]+|C:\\Users\\|AKIA[0-9A-Z]{16}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|github_pat_|ck_[a-f0-9]{20,}|cs_[a-f0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|api[_-]?key *[:=]|password *[:=]|[0-9]{1,5} [A-Z][a-z]+ (Dr|Drive|Rd|Road|St|Street|Ln|Lane|Ave|Avenue|Trail|Trce|Pkwy|Ct|Court|Way|Cir|Circle|Pike|Blvd|Hwy|Highway)\b|\b[0-9]{3}-[0-9]{2}-[0-9]{4}\b'
NAMES_FILE="$(dirname "$0")/.gate-names"   # private, gitignored: one term per line
# 3) Roadmap language. The public repo is a snapshot of practice, not a roadmap (owner's rule, 2026-09-06).
#    Chapters and the README say how to run it today and nothing about where it is going. Blocks, not warns:
#    at the time it was added no chapter tripped it, so a hit is a real leak and not noise.
ROADMAP='HORIZON|\bend goals?\b|\bend[- ]states?\b|\bdestination\b|consciousness|\brobots?\b|\bthe car\b'
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in */gate.sh) continue;; esac
  # 555-01xx numbers are reserved for fiction (NANPA) and are the only phone numbers allowed in examples and tests.
  # They are removed (with any +1 / 1 prefix) before the pattern runs, so a real number beside one is still caught.
  FICTION='(\+?1[-. ]?)?\(?[0-9]{3}\)?[-. ]?555[-. ]?01[0-9]{2}'
  if git show ":$f" | sed -E "s/$FICTION//g" | grep -nEi "$PATTERN" >/dev/null; then echo "gate: BLOCKED pattern in $f"; git show ":$f" | sed -E "s/$FICTION//g" | grep -nEi "$PATTERN" | head -3; fail=1; fi
  if [ -f "$NAMES_FILE" ] && git show ":$f" | grep -nFi -f "$NAMES_FILE" >/dev/null; then echo "gate: BLOCKED private name in $f"; fail=1; fi
  case "$f" in docs/*|README.md)
    if git show ":$f" | grep -nEi "$ROADMAP" >/dev/null; then echo "gate: BLOCKED roadmap language in $f (see PUBLIC-IDENTITY.md, 'Where it is going')"; git show ":$f" | grep -nEi "$ROADMAP" | head -3; fail=1; fi;;
  esac
done
if [ $fail -eq 0 ]; then echo "gate: clean ($(echo $FILES | wc -w | tr -d ' ') files)"; else exit 1; fi
