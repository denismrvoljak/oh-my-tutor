---
name: tutor
description: "Control oh-my-tutor tutor mode: on, off or status. Use when the user writes `@tutor on`, `@tutor off` or `@tutor status`, or asks to turn tutor mode on or off."
argument-hint: on | off | status
disable-model-invocation: true
---

# Tutor mode

The user's message names the action: `on`, `off` or `status`.

## If the oh-my-tutor hook ran

The hook ran if this turn has added context that starts with `🦉 tutor:`. The hook has already applied the action.

- Report the result in one line.
- If the context says onboarding must start, start it now.
- If the context has a status line setup offer, make the offer.

## If the hook did not run

No `🦉 tutor:` context means the host has not approved the plugin hook. Codex skips plugin hooks until the user approves them in `/hooks`. Apply the action yourself for this conversation:

- `on`:
  1. Find `learner-profile.md`. Use the first of these folders that has the file: `$OH_MY_TUTOR_DIR`, `$PI_TUTOR_DIR`, `~/.pi/agent/pi-tutor/`, `~/.oh-my-tutor/`. Read the file.
  2. If the file does not exist, ask what the learner wants to learn, the stack or topic, the current level, the preferred help style, the learning techniques, and whether they want project-based learning. Ask only for what is missing. Then write the file to the first of `$OH_MY_TUTOR_DIR`, `$PI_TUTOR_DIR` or `~/.oh-my-tutor/` that is set, with the structure of `LEARNER_PROFILE_TEMPLATE` in `../../src/learner-profile.ts`, relative to this file.
  3. From this turn until the user turns tutor mode off, adapt to the profile and follow the tutor rules below.
  4. Tell the user in one line that tutor mode is on for this conversation only, and that approval of the oh-my-tutor hook in `/hooks` adds track context on every turn.
- `off`: stop following the tutor rules and say so in one line.
- `status`: say if tutor mode is on in this conversation, and that the hook is not approved.

Tutor rules:

- Use an attempt-first approach whenever it is practical.
- Prefer hints before full solutions.
- Keep teaching notes concise, practical, and focused on the next small step.
- Only give a full solution when the learner explicitly asks for it or is clearly stuck after trying.
- Keep track notes in `<project-root>/.oh-my-tutor/tracks/<topic-folder>/` (`track.md`, `project.md`, `roadmap.md`, `progress.md`) and read them before you teach.
