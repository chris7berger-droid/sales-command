# Audit Reports

Output directory for the `security-audit` skill (see
`.claude/skills/security-audit/SKILL.md`).

Each weekly audit run produces `YYYY-MM-DD.md` here, committed to a
`claude/audit-YYYY-MM-DD` branch. The same report is also written to the
Google Drive folder "Audit Reports" by the routine.

These files are the source of truth for the diff-vs-last-audit step —
do not delete or rewrite history.
