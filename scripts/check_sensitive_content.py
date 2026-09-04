#!/usr/bin/env python3
"""Reject credentials and browser sign-in artifacts in the public plugin source tree."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PATTERNS = (
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[opsu]_[A-Za-z0-9]{20,}\b")),
    ("AWS access key", re.compile(r"\bAKIA[A-Z0-9]{16}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("payment secret", re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b")),
    ("FeedbackServer legacy token", re.compile(r"\bfs(?:at|rt)_[A-Za-z0-9_-]{32,}\b")),
    ("FeedbackServer personal access token", re.compile(r"\bfspat_[A-Za-z0-9_-]{24,}\b")),
    ("bearer JWT", re.compile(r"\bBearer\s+eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b", re.I)),
    ("browser session", re.compile(r"\b(?:better-auth\.)?session_token\s*=\s*[^\s;]{16,}", re.I)),
    ("live magic link", re.compile(r"/magic-link/verify\?[^\s`\"']*\btoken=[A-Za-z0-9._~-]{12,}", re.I)),
    ("secret environment assignment", re.compile(r"\b(?:DATABASE_URL|POSTGRES_PASSWORD|S3_SECRET_ACCESS_KEY|DOKPLOY_API_KEY|AUTH_SECRET)\s*=", re.I)),
    ("URL credentials", re.compile(r"https?://[^\s/:]+:[^\s/@]+@[^\s/]+")),
)
EXCLUDED = {".git", "node_modules", "__pycache__"}
findings: list[str] = []

for path in ROOT.rglob("*"):
    if not path.is_file() or any(part in EXCLUDED for part in path.parts):
        continue
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    for number, line in enumerate(content.splitlines(), start=1):
        for label, pattern in PATTERNS:
            if pattern.search(line):
                findings.append(f"{path.relative_to(ROOT)}:{number} ({label})")

if findings:
    raise RuntimeError(f"Potential sensitive content found at {', '.join(findings)}")

print("No credentials, browser sessions, bearer JWTs, or live magic links detected in the public source tree.")
