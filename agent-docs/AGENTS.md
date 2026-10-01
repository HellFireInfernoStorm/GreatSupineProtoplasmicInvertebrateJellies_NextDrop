# agent-docs: editing the project documents

- Every file under `spec/`, `design/` and `brief/` (except `README.md`) starts with a header: `status: draft | agreed`, `owner`, `sources`. See [spec-changes.md](process/spec-changes.md).
- `agreed` is binding. `draft` is current best intent. Do not flip a file to `agreed` without the owner's approval in the PR.
- If you change behaviour the spec describes, edit the spec file in the same PR. If it is a deviation or a newly settled decision, add an ADR from [adr/0000-template.md](adr/0000-template.md) as well.
- The spec states the new truth in place. Never write "see ADR for the real behaviour".
- Keep files under 300 lines (soft limit). Split by concern instead of growing a file.
- `README.md` in each directory is an index. The status table in `agent-docs/README.md` is generated: run `pnpm agent:index`.
- Do not copy text between documents. Link to it.
- `brief/challenge-booklet.md` is the organisers' text, copied unchanged. Do not edit it.
