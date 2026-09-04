#!/usr/bin/env python3
"""Validate the runtime-free FeedbackKit 2.0 remote MCP plugin distribution."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "feedback-server"
VERSION = "2.0.0"
MCP_URL = "https://api.feedkit.cn/mcp"
SKILLS = (
    "setup-feedback-server",
    "triage-feedback",
    "manage-waitlist",
    "publish-roadmap-releases",
    "configure-notifications",
    "administer-feedback-server",
    "manage-feedback-server",
)
EVALS = (
    "browser-oauth",
    "error-recovery",
    "negative-unrelated-feedback",
    "publishing",
    "setup",
    "triage",
    "triage-direct-write",
    "waitlist",
)


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    require(isinstance(value, dict), f"{path} must contain a JSON object")
    return value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


package = load(ROOT / "package.json")
codex = load(PLUGIN / ".codex-plugin" / "plugin.json")
claude = load(PLUGIN / ".claude-plugin" / "plugin.json")
mcp = load(PLUGIN / ".mcp.json")
codex_marketplace = load(ROOT / ".agents" / "plugins" / "marketplace.json")
claude_marketplace = load(ROOT / ".claude-plugin" / "marketplace.json")
cursor = load(ROOT / "examples" / "cursor.mcp.json")
opencode = load(ROOT / "examples" / "opencode.json")

require(package.get("version") == VERSION, f"Package distribution version must be {VERSION}")
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
require(
    mcp.get("feedback-server") == {"type": "http", "url": MCP_URL},
    "Remote MCP descriptor is invalid",
)

codex_entries = codex_marketplace.get("plugins")
require(isinstance(codex_entries, list) and len(codex_entries) == 1, "Codex marketplace must contain one plugin")
codex_entry = codex_entries[0]
require(codex_entry.get("name") == "feedback-server", "Codex marketplace plugin name is invalid")
require(
    codex_entry.get("source") == {"source": "local", "path": "./plugins/feedback-server"},
    "Codex marketplace source is invalid",
)
require(
    codex_entry.get("policy") == {"installation": "AVAILABLE", "authentication": "ON_USE"},
    "Codex marketplace must defer browser OAuth until first protected use",
)

claude_entries = claude_marketplace.get("plugins")
require(isinstance(claude_entries, list) and len(claude_entries) == 1, "Claude marketplace must contain one plugin")
claude_entry = claude_entries[0]
require(claude_entry.get("version") == VERSION, "Claude marketplace version differs")
require(claude_entry.get("strict") is True, "Claude marketplace must use strict metadata")

require(
    cursor.get("mcpServers", {}).get("feedback-server", {}).get("url") == MCP_URL,
    "Cursor example is not remote",
)
require(
    opencode.get("mcp", {}).get("feedback-server", {}).get("url") == MCP_URL,
    "OpenCode example is not remote",
)

declared_claude_skills = claude.get("skills")
require(
    declared_claude_skills == [f"./skills/{skill}" for skill in SKILLS],
    "Claude manifest skill list is incomplete or out of order",
)

skill_texts: dict[str, str] = {}
for skill in SKILLS:
    path = PLUGIN / "skills" / skill / "SKILL.md"
    require(path.is_file(), f"Missing skill: {skill}")
    content = text(path)
    skill_texts[skill] = content
    require("2.0" in content, f"Skill {skill} must explicitly target FeedbackServer 2.0")
    require("elicitation" in content, f"Skill {skill} must prefer MCP elicitation for risky tools")
    require("`confirm: true`" in content, f"Skill {skill} must document the v2 fallback confirmation")
    metadata = text(PLUGIN / "skills" / skill / "agents" / "openai.yaml")
    require(
        'transport: "streamable_http"' in metadata,
        f"Skill {skill} must declare the Streamable HTTP MCP transport",
    )

setup_skill = skill_texts["setup-feedback-server"]
for required in (
    "Better Auth",
    "magic link",
    "`whoami`",
    "`list_products`",
    "`create_product`",
    "`set_notification_setup_preference`",
    "`mcp_server`",
    "`account_email`",
):
    require(required in setup_skill, f"Setup skill is missing the v2 setup contract: {required}")

triage_skill = skill_texts["triage-feedback"]
normalized_triage_skill = " ".join(triage_skill.split())
for required in ("`update_feedback`", "`reply_to_feedback`", "without asking the user to approve the same action again"):
    require(required in normalized_triage_skill, f"Triage skill is missing direct-write intent: {required}")

root_readme = text(ROOT / "README.md")
for required in ("FeedbackKit Agent Plugin 2.0", "Better Auth", "`whoami`", "`confirm: true`"):
    require(required in root_readme, f"Root README is missing the v2 contract: {required}")

invitation_docs = (
    ROOT / "docs" / "invited-admin-onboarding.en.md",
    ROOT / "docs" / "invited-admin-onboarding.zh-Hans.md",
)
instruction_field = re.compile(r"^\s*([a-z][a-z0-9_]*):\s+", re.MULTILINE)
for path in invitation_docs:
    content = text(path)
    fields = set(instruction_field.findall(content))
    require(fields == {"mcp_server", "account_email"}, f"Invitation instructions in {path.name} must use only mcp_server and account_email")
    require("`whoami`" in content and "magic" in content.casefold(), f"Invitation instructions in {path.name} must use the v2 browser flow")

eval_root = PLUGIN / "evals"
actual_evals = tuple(sorted(path.name for path in eval_root.iterdir() if path.is_dir()))
require(actual_evals == EVALS, "Eval directories must exactly cover the FeedbackServer 2.0 suite")
for eval_name in EVALS:
    path = eval_root / eval_name / "case.yaml"
    require(path.is_file(), f"Missing eval case: {eval_name}")
    content = text(path)
    for marker in (
        'schema_version: "1.1"',
        "description:",
        "execution:",
        "  prompt:",
        "  allowed_tools:",
        "graders:",
        "expected_outcome:",
    ):
        require(marker in content, f"Eval {eval_name} is missing required field: {marker.strip()}")
    require("v2" in content.casefold() or "2.0" in content, f"Eval {eval_name} does not explicitly target v2")

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
        content = text(path)
    except UnicodeDecodeError:
        continue
    contract_contents.append((path, content))

retired_tool_names = (
    "authen" + "ticate",
    "authentication_" + "status",
    "connection_" + "status",
    "get_onboarding_" + "status",
    "execute_" + "confirmation",
)
for path, content in contract_contents:
    for tool_name in retired_tool_names:
        pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(tool_name)}(?![A-Za-z0-9_])", re.IGNORECASE)
        require(not pattern.search(content), f"Retired tool name remains in {path.relative_to(ROOT)}")

retired_setup_markers = (
    "pending_" + "verification",
    "empty " + "scopes list",
    "unbound " + "connection",
    "account " + "binding",
    "invitation " + "code",
    "short-" + "code",
    "pairing " + "code",
    "verification " + "code",
    'method: "' + 'invitation"',
    'method: "' + 'email"',
)
for path, content in contract_contents:
    folded = content.casefold()
    found = [marker for marker in retired_setup_markers if marker.casefold() in folded]
    require(not found, f"Retired setup guidance remains in {path.relative_to(ROOT)}")

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

print(f"FeedbackServer Plugin {VERSION} is a valid v2-only runtime-free remote MCP distribution.")
