# AGENTS.md - AI Development Guidelines

## Overview
This repo is developed collaboratively between a human (Andrew) and AI agents (Marvin + sub-agents). Each feature is built via PR from a dedicated sub-agent session.

## Workflow

### Before Starting Work
1. Read `SPEC.md` for project context
2. Read any linked issue for specific requirements
3. Check existing code patterns before introducing new ones

### Development Process
1. Create a feature branch from `main`
2. Implement the feature with tests
3. Open a PR linking to the issue
4. Wait for review before merge

### Code Standards
- Write tests for new functionality
- Keep PRs focused — one feature/fix per PR
- Document public APIs
- Prefer clarity over cleverness

### Commit Messages
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Keep first line under 72 chars
- Reference issue numbers where applicable

## Communication
- Sub-agents report PR status to the main Slack channel
- If blocked or need clarification, ask rather than assume
- Andrew reviews all PRs before merge

## Tech Decisions
- Document significant decisions in `docs/decisions/` (ADR format)
- When multiple approaches exist, present options rather than picking one

---

*This file is the contract between human and AI developers.*
