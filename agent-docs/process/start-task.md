# Starting a task

A GitHub issue is the task brief. The agent-maintained plan comment on the issue is the live state. The PR is the handoff.

1. **Read the issue and all comments.** `gh issue view N --comments`, or the GitHub MCP tools if `gh` is unavailable ([github-access.md](github-access.md)). If neither works, ask the developer for the text. Never infer an issue's content.
2. **Read what it links.** The issue form has a required "links" field naming the spec files and ADRs. Read those, plus the nested `AGENTS.md` of the directories you will touch.
3. **Check blockers.** If the issue lists "Blocked by", confirm those issues are merged or say so on the issue.
4. **Create the branch** `<issue-number>-short-slug`, for example `42-publish-transaction`. Harness-assigned branches matching `claude/*` are exempt from the name check; keep the issue number in the PR.
5. **Post the plan** as a comment beginning with the marker below. Use the same comment from then on: edit it, do not add new ones.

   ```
   <!-- agent-plan -->
   ## Plan
   - [ ] step one
   - [ ] step two

   ## Decisions so far
   - ...

   ## Handoff notes
   - What is done, what is next, anything surprising.
   ```

6. **Work in small steps** and keep the plan comment current. A person or another harness must be able to continue from it alone.
7. **Spec and ADRs.** Anything that must last (a deviation, a settled open question) goes into the spec and an ADR in the same PR: [spec-changes.md](spec-changes.md). The plan comment is working state only.
8. **Open the PR** with the template, when the developer asks for it: [pr-and-commits.md](pr-and-commits.md).

If the issue contradicts the spec or the Booklet, stop and comment on the issue. See the precedence rule in the root `AGENTS.md`.
