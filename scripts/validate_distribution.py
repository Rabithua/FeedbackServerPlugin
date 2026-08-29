#!/usr/bin/env python3
"""Validate the runtime-free FeedbackKit remote MCP plugin distribution."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "feedback-server"
VERSION = "1.2.1"
MCP_URL = "https://api.feedkit.cn/mcp"


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    assert isinstance(value, dict), f"{path} must contain a JSON object"
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


codex = load(PLUGIN / ".codex-plugin" / "plugin.json")
claude = load(PLUGIN / ".claude-plugin" / "plugin.json")
mcp = load(PLUGIN / ".mcp.json")
codex_marketplace = load(ROOT / ".agents" / "plugins" / "marketplace.json")
claude_marketplace = load(ROOT / ".claude-plugin" / "marketplace.json")
cursor = load(ROOT / "examples" / "cursor.mcp.json")
opencode = load(ROOT / "examples" / "opencode.json")

require(codex.get("name") == PLUGIN.name, "Plugin folder and Codex manifest name differ")
require(codex.get("version") == VERSION, f"Codex plugin version must be {VERSION}")
require(claude.get("version") == VERSION, f"Claude plugin version must be {VERSION}")
require(codex.get("skills") == "./skills/", "Codex skills path is invalid")
require(
    codex.get("mcpServers") == {
        "feedback-server": {"type": "http", "url": MCP_URL},
    },
    "Codex must declare the remote HTTP MCP endpoint",
)
require("apps" not in codex, "Do not add an app manifest until the real connector ID is registered")
require("mcpServers" not in claude, "Claude must use the canonical root .mcp.json")
require(mcp.get("feedback-server") == {"type": "http", "url": MCP_URL}, "Remote MCP descriptor is invalid")

entries = codex_marketplace.get("plugins")
require(isinstance(entries, list) and len(entries) == 1, "Codex marketplace must contain one plugin")
entry = entries[0]
require(entry.get("name") == "feedback-server", "Codex marketplace plugin name is invalid")
require(entry.get("source") == {"source": "local", "path": "./plugins/feedback-server"}, "Codex marketplace source is invalid")
require(entry.get("policy") == {"installation": "AVAILABLE", "authentication": "ON_USE"}, "Codex marketplace must defer authentication until first protected tool use")

claude_entries = claude_marketplace.get("plugins")
require(isinstance(claude_entries, list) and len(claude_entries) == 1, "Claude marketplace must contain one plugin")
require(claude_entries[0].get("version") == VERSION, "Claude marketplace version differs")
require(claude_entries[0].get("strict") is True, "Claude marketplace must use strict metadata")

require(cursor.get("mcpServers", {}).get("feedback-server", {}).get("url") == MCP_URL, "Cursor example is not remote")
require(opencode.get("mcp", {}).get("feedback-server", {}).get("url") == MCP_URL, "OpenCode example is not remote")

root_readme = (ROOT / "README.md").read_text(encoding="utf-8")
setup_skill = (PLUGIN / "skills" / "setup-feedback-server" / "SKILL.md").read_text(
    encoding="utf-8"
)
require(
    "protocol discovery and `health`" in root_readme,
    "Root README must limit anonymous access to MCP discovery and health",
)
for required in (
    'authenticate({ method: "email", value: email })',
    'authenticate({ method: "invitation", value: invitationCode })',
    "empty scopes list",
    "pending_verification",
    "authentication_status",
    "connection_status",
):
    require(required in setup_skill, f"Setup skill is missing authentication contract: {required}")

contract_paths = sorted(
    path
    for path in ROOT.rglob("*")
    if path.is_file()
    and ".git" not in path.parts
    and "__pycache__" not in path.parts
)
contract_contents: list[tuple[Path, str]] = []
for path in contract_paths:
    try:
        content = path.read_text(encoding="utf-8").casefold()
    except UnicodeDecodeError:
        continue
    contract_contents.append((path, content))

retired_markers = (
    "accept_" "invitation",
    "invitation_" "token",
    "connection " "code",
    "pairing " "code",
    "email " "code",
    "six-" "digit",
    "six " "digits",
    "invitation " "handoff",
    "十位连接" "码",
    "配对" "码",
    "六位验证" "码",
)
for path, content in contract_contents:
    found = [marker for marker in retired_markers if marker.casefold() in content]
    require(not found, f"Retired authentication guidance remains in {path.relative_to(ROOT)}")

invalid_authenticate_inputs = tuple(
    value
    for method, field in (("email", "email"), ("invitation", "code"))
    for value in (
        f'authenticate({{ method: "{method}", {field}',
        f'{{ "method": "{method}", "{field}"',
    )
)
for path, content in contract_contents:
    found = [value for value in invalid_authenticate_inputs if value.casefold() in content]
    require(not found, f"Invalid authenticate input fields remain in {path.relative_to(ROOT)}")

skills = (
    "setup-feedback-server",
    "triage-feedback",
    "manage-waitlist",
    "publish-roadmap-releases",
    "configure-notifications",
    "administer-feedback-server",
    "manage-feedback-server",
)
for skill in skills:
    require((PLUGIN / "skills" / skill / "SKILL.md").is_file(), f"Missing skill: {skill}")
    metadata = (PLUGIN / "skills" / skill / "agents" / "openai.yaml").read_text(
        encoding="utf-8"
    )
    require(
        'transport: "streamable_http"' in metadata,
        f"Skill {skill} must declare the Streamable HTTP MCP transport",
    )

for forbidden in ("bin", "dist", "src", "scripts", "tests"):
    directory = PLUGIN / forbidden
    require(
        not directory.exists() or not any(path.is_file() for path in directory.rglob("*")),
        f"Runtime directory must not ship files: {forbidden}",
    )
for forbidden in ("bun.lock", "package.json", "tsconfig.json", "eslint.config.js"):
    require(not (PLUGIN / forbidden).exists(), f"Runtime file must not ship: {forbidden}")

allowed_root = {
    ".agents", ".claude-plugin", ".git", ".github", ".gitignore", "CHANGELOG.md",
    "LICENSE", "README.md", "docs", "examples", "package.json", "plugins", "scripts",
}
unexpected = sorted(path.name for path in ROOT.iterdir() if path.name not in allowed_root)
require(not unexpected, f"Unexpected public repository paths: {', '.join(unexpected)}")

private_names = {".env", "docker-compose.yml", "drizzle.config.ts", "DOKPLOY.md"}
private_paths = sorted(
    str(path.relative_to(ROOT))
    for path in ROOT.rglob("*")
    if path.is_file() and ".git" not in path.parts and path.name in private_names
)
require(
    not private_paths,
    f"Private deployment files must not ship: {', '.join(private_paths)}",
)

print(f"FeedbackServer Plugin {VERSION} is a valid runtime-free remote MCP distribution.")
