// Claude Code UserPromptSubmit hook: the Claude counterpart of extensions/oh-my-tutor.
// It reuses the Pi extension's prompt builders. Node strips the TypeScript types on import (Node >= 22.18).
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { STATE_DIR, STATUSLINE_LAUNCHER, sessionFlagPath } from "./paths.mjs";
import { buildTutorModeSystemPrompt, parseTutorCommand } from "../extensions/oh-my-tutor/index.ts";
import {
  buildConversationalOnboardingPrompt,
  buildLearnerProfilePrompt,
  buildOnboardingKickoffMessage,
  loadLearnerProfileMarkdown,
  resolveLearnerProfilePath,
} from "../src/learner-profile.ts";
import {
  buildTrackContextPrompt,
  buildTrackCreationPrompt,
  matchTrackFromPrompt,
  resolveProjectRoot,
  resolveTracksRoot,
  shouldConsiderTrack,
} from "../src/tracks.ts";

const PROMPT_WORKFLOWS = new Set(["start_tutoring", "hint", "reflect", "next_step"]);
const WORKFLOWS = new Set([...PROMPT_WORKFLOWS, "tutor-implementation", "tutor-learn-topic"]);

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { prompt = "", session_id: sessionId = "default", cwd = process.cwd() } = JSON.parse(raw);

// Tutor mode is per session, like in Pi. shortcut: one tiny file per session is never cleaned up; prune if it ever matters.
const flagPath = sessionFlagPath(sessionId);
let enabled = await stat(flagPath).then(() => true, () => false);

// Codex sets PLUGIN_DATA for plugin hooks; Claude Code sets CLAUDE_PLUGIN_DATA.
const isCodex = Boolean(process.env.PLUGIN_DATA);
const badge = () => `🦉 tutor: ${enabled ? "ON" : "OFF"}`;

const reply = (output) => process.stdout.write(JSON.stringify(output));
// The badge leads the context because Codex shows the context in its transcript; it has no footer item for plugins.
// systemMessage shows the badge to the user in Claude Code. Codex renders it as a yellow warning, so Codex gets none.
const addContext = (context, announce = false) =>
  reply({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `${badge()}\n\n${context}` },
    ...(announce && !isCodex ? { systemMessage: badge() } : {}),
  });

// A plugin cannot set Claude Code's status line, so ask Claude to offer the setup. Once only: a repeated offer is a nag.
async function statusLineOffer() {
  if (isCodex) return undefined;
  const settingsPath = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
  const command = await readFile(settingsPath, "utf8").then((text) => JSON.parse(text).statusLine?.command, () => undefined);
  if (String(command).includes("oh-my-tutor")) return undefined;
  const offeredPath = join(STATE_DIR, "statusline-offered");
  if (await stat(offeredPath).then(() => true, () => false)) return undefined;
  await writeFile(offeredPath, new Date().toISOString());
  const run = "node ~/.oh-my-tutor/statusline.mjs";
  return command
    ? `Status line setup: Claude Code can show "🦉 tutor: ON" in its footer. The user already has a status line command in ${settingsPath}. Offer once to add the tutor badge to it: their script can pass its stdin to \`${run}\` and print the output. Do not replace their status line. Change nothing unless the user agrees.`
    : `Status line setup: Claude Code can show "🦉 tutor: ON" in its footer, but no status line is configured. Offer once to add this to ${settingsPath}: "statusLine": { "type": "command", "command": "${run}" }. Change nothing unless the user agrees.`;
}

// The launcher is a stable path for the statusLine setting; the plugin's own path changes with each version.
// It stays silent when an update removed the old plugin folder, until the next tutor turn rewrites it.
const writeLauncher = () =>
  writeFile(
    STATUSLINE_LAUNCHER,
    `try { await import(${JSON.stringify(new URL("statusline.mjs", import.meta.url).href)}); } catch {}\n`,
  );

// Plugin commands arrive as "/tutor:<name> args"; accept the bare "/<name>" form too.
// "/" is a Claude Code command; "$" is a Codex skill mention, the closest thing Codex has to a plugin command.
// Codex can also send a mention as a markdown link: "[@tutor](plugin://tutor@oh-my-tutor) on".
const [, sigil, command, args = ""] =
  prompt.trim().match(/^\[?([/$@])(?:tutor:)?([\w-]+)(?:\]\([^)]*\))?\s*([\s\S]*)$/) ?? [];
// Answer in the syntax the user typed: "@tutor on" / "$hint" in Codex, "/tutor:hint" in Claude Code.
const cmd = (name) => (sigil === "/" ? `/tutor:${name}` : `${sigil}${name}`);
const profilePath = resolveLearnerProfilePath();

if (command === "tutor") {
  const action = parseTutorCommand(args);
  if (!action) {
    reply({ decision: "block", reason: `Usage: ${cmd("tutor")} on | off | status` });
  } else {
    if (action === "on") {
      await mkdir(dirname(flagPath), { recursive: true });
      await writeFile(flagPath, new Date().toISOString());
      await writeLauncher();
      enabled = true;
    } else if (action === "off") {
      await rm(flagPath, { force: true });
      enabled = false;
    }
    const profile = await loadLearnerProfileMarkdown();
    const lines = [
      enabled
        ? "Tutor mode is ON. Expect attempt-first guidance, hints before full solutions, and concise teaching notes."
        : "Tutor mode is OFF. Standard coding-assistant behavior is active.",
      profile ? `Learner profile loaded from ${profilePath}.` : `No learner profile exists yet at ${profilePath}.`,
    ];
    if (enabled && !profile) {
      lines.push(buildOnboardingKickoffMessage(profilePath), buildConversationalOnboardingPrompt(profilePath));
    }
    const offer = action === "on" && (await statusLineOffer());
    if (offer) lines.push(offer);
    addContext(lines.join("\n\n"), true);
  }
} else if (WORKFLOWS.has(command) && !enabled) {
  reply({ decision: "block", reason: `Tutor mode is off. Run ${cmd("tutor")} on before using ${cmd(command)}.` });
} else if (enabled) {
  await writeLauncher();
  const profile = await loadLearnerProfileMarkdown();
  const parts = [buildTutorModeSystemPrompt("").trim()];
  // Claude Code expands /tutor:hint itself. Codex has no plugin commands, so "$hint x" needs the template from here.
  if (sigil && sigil !== "/" && PROMPT_WORKFLOWS.has(command)) {
    const template = await readFile(new URL(`../prompts/${command}.md`, import.meta.url), "utf8");
    parts.push(template.replace(/^---[\s\S]*?---\n/, "").replaceAll("$ARGUMENTS", args).trim());
  }
  if (!profile) {
    parts.push(buildConversationalOnboardingPrompt(profilePath));
  } else {
    parts.push(buildLearnerProfilePrompt(profile));
    const projectRoot = resolveProjectRoot(cwd);
    const track = await matchTrackFromPrompt(prompt, projectRoot);
    if (track) parts.push(buildTrackContextPrompt(track));
    else if (shouldConsiderTrack(prompt)) parts.push(buildTrackCreationPrompt(resolveTracksRoot(projectRoot)));
  }
  addContext(parts.join("\n\n"));
}
