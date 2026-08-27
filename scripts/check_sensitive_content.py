#!/usr/bin/env python3
"""Reject common credential material in the public plugin source tree."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bgh[opsu]_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bfspat_[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bfsat_[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bfsrt_[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\bfsinv_[A-Za-z0-9_-]{32,}\b"),
    re.compile(r"\b(?:DATABASE_URL|POSTGRES_PASSWORD|S3_SECRET_ACCESS_KEY|DOKPLOY_API_KEY)\s*=", re.I),
    re.compile(r"https?://[^\s/:]+:[^\s/@]+@[^\s/]+"),
)
EXCLUDED = {".git", "node_modules", "__pycache__"}
findings: list[str] = []

for path in ROOT.rglob("*"):
    if not path.is_file() or any(part in EXCLUDED for part in path.parts):
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    for number, line in enumerate(text.splitlines(), start=1):
        if any(pattern.search(line) for pattern in PATTERNS):
            findings.append(f"{path.relative_to(ROOT)}:{number}")

if findings:
    raise RuntimeError(f"Potential sensitive content found at {', '.join(findings)}")

print("No sensitive credential material detected in the public source tree.")
