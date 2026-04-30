# Authoring a skill

Source: [`databricks-skills/TEMPLATE/`](../../databricks-skills/TEMPLATE/), [`.github/scripts/validate_skills.py`](../../.github/scripts/validate_skills.py)

## File layout

A skill is a directory under `databricks-skills/<skill-name>/` containing at minimum a `SKILL.md`:

```
databricks-skills/my-new-skill/
├── SKILL.md                # required
├── reference-1.md          # optional supporting docs
├── examples/example.py     # optional supporting files
└── ...
```

There is a `TEMPLATE/` directory in the same path you can copy as a starting point. The validator skips it explicitly.

## SKILL.md format

Markdown with **YAML frontmatter** at the top:

```markdown
---
name: my-new-skill
description: One or two sentences. The agent matches user intent against this string to decide whether to load the skill — be specific about triggers.
---

# My New Skill

## Overview

What this skill teaches and when it applies.

## Quick Start

Smallest concrete example.

## Common Patterns

### Pattern 1
...

## Reference Files

- [reference-1.md](reference-1.md) — what's in it

## Common Issues

| Issue | Solution |
|-------|----------|
| ...   | ...      |
```

### Frontmatter rules (enforced by `validate_skills.py`)

| Field | Rule |
|-------|------|
| `name` | Required. ≤ 64 chars. `[a-z0-9]+(-[a-z0-9]+)*` only. No XML tags. Must not contain the words `anthropic` or `claude`. |
| `description` | Required, non-empty. ≤ 1024 chars. No XML tags. |

The validator runs in CI under `validate-skills` (see `.github/workflows/ci.yml`). To run it manually:

```bash
python .github/scripts/validate_skills.py
```

It also enforces a **registration check**: every skill directory under `databricks-skills/` must appear in at least one skill-list variable in `install_skills.sh`. The validator auto-discovers those variables — there is no separate registry file.

## Writing a good description

The description is the *only* hint the agent gets at trigger-selection time. Treat it like a router.

Patterns that work in this repo:

- **Lead with what it does, not what it covers.** `"Create and configure Databricks Asset Bundles..."` outperforms `"Documentation for Asset Bundles."`
- **Enumerate concrete user phrases.** Several skills include explicit phrase lists: *"Use when the user mentions X, Y, Z, or asks to do A, B, C."* This is verbose, but reliable.
- **Disambiguate from siblings.** If two skills could plausibly match (e.g. `databricks-lakebase-provisioned` vs. `databricks-lakebase-autoscale`), spell out the discriminator in both descriptions.
- **Be terse where you can.** Descriptions count against the agent's context budget at every turn — they are read often.

Counter-pattern to avoid: descriptions that read like marketing copy. The agent doesn't need *why* the feature exists, it needs to know *when* to load the skill.

## Supporting files

Skills can include any additional Markdown, Python, YAML, or shell scripts. The local-install path uses a per-skill **explicit allowlist** in `install_skills.sh::get_skill_extra_files`. If you add a new file alongside `SKILL.md`, you must add it to the matching `case` arm or the file won't be downloaded for users running the curl-based install.

This is intentional: the install path uses `curl` per file (no archive download), and silently adding a new file would mean some users get it and others don't depending on which installer they used.

The Genie Code notebook installer (`install_genie_code_skills.py`) takes a different approach — it discovers files via the GitHub Trees API and recursively uploads everything except dotfiles and `TEMPLATE`.

## Conventions

- **One skill, one directory.** Don't share supporting files across skills.
- **Reference files start with a number** when reading order matters: `1-ingestion-patterns.md`, `2-streaming-patterns.md`. Several skills do this.
- **Keep `SKILL.md` short.** It is loaded eagerly when the trigger fires; reference files are loaded lazily by the agent on demand. Push long content into reference files.
- **Use code blocks the agent can copy.** Don't paraphrase.
- **No XML tags in frontmatter.** Validator rejects them.
- **No reserved words in `name`.** Validator rejects `anthropic` / `claude`.

## After adding a skill

1. Validate: `python .github/scripts/validate_skills.py`.
2. Register the skill name in `install_skills.sh` under `DATABRICKS_SKILLS=` (the validator checks this).
3. If the skill has supporting files: add a case arm to `get_skill_extra_files` in the same script.
4. (If user-facing) add the skill to the README skills table.
5. Bump the appropriate persona profile in `install.sh` if the skill belongs to one (`PROFILE_DATA_ENGINEER` etc.) — see [profiles.md](profiles.md).
6. Add or update the matching MCP wrapper if there is one (see [`../mcp/`](../mcp/)).

> Skills only ship after a release. The default install path clones the latest release tag, not `main`. Even after merging, the new skill won't reach users via the install one-liner until the next release is cut.
