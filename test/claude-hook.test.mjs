import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const hook = new URL("../claude/user-prompt-submit.mjs", import.meta.url).pathname;

// extraEnv { PLUGIN_DATA } makes the hook act as it does under Codex.
function run(env, prompt, sessionId = "s1", extraEnv = {}) {
  const { CLAUDE_CONFIG_DIR, PLUGIN_DATA, ...base } = process.env;
  const out = execFileSync("node", [hook], {
    input: JSON.stringify({ prompt, session_id: sessionId, cwd: env.cwd }),
    env: { ...base, HOME: env.home, OH_MY_TUTOR_DIR: env.tutor, ...extraEnv },
  }).toString();
  return out ? JSON.parse(out) : undefined;
}

test("claude hook toggles tutor mode per session and gates workflows", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tutor-claude-"));
  const env = { home: join(root, "home"), tutor: join(root, "tutor"), cwd: root };

  assert.equal(run(env, "plain question"), undefined);
  assert.equal(run(env, "/tutor:hint loops").decision, "block");
  assert.match(run(env, "$hint loops").reason, /Run \$tutor on before using \$hint/); // Codex skill mention
  assert.match(run(env, "/tutor:hint loops").reason, /Run \/tutor:tutor on before using \/tutor:hint/);
  assert.match(run(env, "@tutor bogus").reason, /Usage: @tutor on/); // Codex plugin mention
  assert.equal(run(env, "/tutor:tutor bogus").decision, "block");

  const onReply = run(env, "/tutor:tutor on");
  const on = onReply.hookSpecificOutput.additionalContext;
  assert.match(on, /^🦉 tutor: ON\n/);
  assert.equal(onReply.systemMessage, "🦉 tutor: ON");
  assert.match(on, /Tutor mode is ON/);
  assert.match(on, /Start conversational onboarding/);
  // The status line offer appears once, then never again.
  assert.match(on, /no status line is configured[\s\S]*node ~\/\.oh-my-tutor\/statusline\.mjs/);
  assert.doesNotMatch(run(env, "/tutor:tutor on").hookSpecificOutput.additionalContext, /Status line setup/);

  mkdirSync(env.tutor, { recursive: true });
  writeFileSync(join(env.tutor, "learner-profile.md"), "# Learner Profile\n- Current level: beginner\n");
  const turn = run(env, "/tutor:hint loops").hookSpecificOutput.additionalContext;
  assert.match(turn, /Tutor mode is enabled/);
  assert.match(turn, /Current level: beginner/);

  assert.equal(run(env, "plain question", "other-session"), undefined);

  // The launcher the hook wrote shows the indicator only for the session with tutor mode on.
  const statusline = (sessionId) =>
    execFileSync("node", [join(env.home, ".oh-my-tutor", "statusline.mjs")], {
      input: JSON.stringify({ session_id: sessionId }),
      env: { ...process.env, HOME: env.home },
    }).toString();
  assert.match(statusline("s1"), /🦉 .*tutor:.* ON/);
  assert.equal(statusline("other-session"), "");

  assert.match(run(env, "/tutor off").hookSpecificOutput.additionalContext, /Tutor mode is OFF/);
  assert.equal(run(env, "plain question"), undefined);
});

test("claude hook keeps an existing status line and offers to add the badge to it", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tutor-claude-"));
  const env = { home: join(root, "home"), tutor: join(root, "tutor"), cwd: root };
  mkdirSync(join(env.home, ".claude"), { recursive: true });
  const settings = join(env.home, ".claude", "settings.json");

  writeFileSync(settings, JSON.stringify({ statusLine: { type: "command", command: "my-line.sh" } }));
  assert.match(run(env, "/tutor:tutor on").hookSpecificOutput.additionalContext, /Do not replace their status line/);

  // No offer when the status line already runs the tutor launcher.
  const configured = { ...env, tutor: join(root, "tutor2"), home: join(root, "home2") };
  mkdirSync(join(configured.home, ".claude"), { recursive: true });
  writeFileSync(
    join(configured.home, ".claude", "settings.json"),
    JSON.stringify({ statusLine: { type: "command", command: "node ~/.oh-my-tutor/statusline.mjs" } }),
  );
  assert.doesNotMatch(run(configured, "/tutor:tutor on").hookSpecificOutput.additionalContext, /Status line setup/);
});

test("under Codex the hook shows the badge in context, sends no systemMessage, and expands $ workflows", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-tutor-codex-"));
  const env = { home: join(root, "home"), tutor: join(root, "tutor"), cwd: root };
  const codex = { PLUGIN_DATA: join(root, "plugin-data") };

  const on = run(env, "[@tutor](plugin://tutor@oh-my-tutor) on", "s1", codex);
  assert.match(on.hookSpecificOutput.additionalContext, /^🦉 tutor: ON\n/);
  assert.equal(on.systemMessage, undefined);
  assert.doesNotMatch(on.hookSpecificOutput.additionalContext, /Status line setup/);

  mkdirSync(env.tutor, { recursive: true });
  writeFileSync(join(env.tutor, "learner-profile.md"), "# Learner Profile\n");
  const hint = run(env, "$hint closures", "s1", codex).hookSpecificOutput.additionalContext;
  assert.match(hint, /^🦉 tutor: ON\n/);
  assert.match(hint, /next helpful hint for this task\/topic: closures/);
  assert.match(hint, /hint ladder/);
  assert.doesNotMatch(hint, /^description:/m);

  // Claude Code expands its own commands, so the hook adds no template there.
  assert.doesNotMatch(run(env, "/tutor:hint closures").hookSpecificOutput.additionalContext, /hint ladder/);
});
