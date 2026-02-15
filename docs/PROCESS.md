# Development Process

This document describes how we (human + AI) collaborate on building git.ly.

## Phases

### Phase 1: Scoping (Current)

**Owner:** Marvin (AI)

**Process:**
1. Marvin identifies decisions that need to be made before building
2. For each decision:
   - Create a GitHub issue with "Decision:" prefix
   - Document options with pros/cons
   - Provide a recommendation
   - Create an ADR file in `docs/decisions/`
3. Andrew reviews and makes decisions via issue comments
4. When a decision is made:
   - Marvin updates the ADR status to "Accepted"
   - Marvin updates SPEC.md if needed
   - Marvin closes the issue
5. When all scoping decisions are made:
   - Marvin creates a "Ready to Build?" issue
   - Summarizes all decisions
   - Awaits Andrew's go-ahead

### Phase 2: Building

**Owner:** Marvin (AI) for implementation, Andrew for review

**Process:**
1. Marvin creates implementation issues
2. For each feature:
   - Spawn a sub-agent session
   - Create a feature branch
   - Implement with tests
   - Open a PR linking to the issue
3. Andrew reviews PRs
4. Marvin iterates based on feedback
5. Andrew merges when satisfied

### Phase 3: Polish & Ship

TBD — define when we get there.

## Issue Labels

| Label | Meaning |
|-------|---------|
| `decision` | Requires a decision from Andrew |
| `implementation` | Ready to build |
| `blocked` | Waiting on something |
| `question` | Needs clarification |

## Communication

- **GitHub Issues:** For decisions and implementation tracking
- **Slack:** For quick questions and status updates
- **PRs:** For code review and iteration

## Ground Rules

1. Decisions are documented in ADRs, not just issue comments
2. SPEC.md is the source of truth for what we're building
3. Close issues when resolved, don't let them linger
4. When in doubt, ask rather than assume

---

*This process evolves as we learn what works.*
