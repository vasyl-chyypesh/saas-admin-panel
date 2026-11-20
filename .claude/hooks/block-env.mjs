// PreToolUse hook: keeps Claude Code away from .env files.
//
// Exit 2 blocks the tool call and feeds stderr back to Claude; exit 0 allows it.
// This is a guardrail against accidental access, not a security boundary: text
// matching on Bash commands cannot catch a script that builds the path at runtime.
// See the "Secrets" section of CLAUDE.md.

import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// `.env` or `.env.<anything>`. Case-insensitive because APFS is, so `.ENV` is the same file.
const ENV_NAME = /^\.env(\..*)?$/i;
const ALLOWED_NAMES = new Set(['.env.example']);

// `.env` as a path token inside free text (a Bash command, a glob). It must not follow a
// word char or dot (so `process.env` and `import.meta.env` pass), must not run on into a
// longer name (so `.envrc` passes), and must not be exactly `.env.example`.
const ENV_TOKEN = /(?:^|[^\w.])\.env(?![\w-])(?!\.example(?![\w.-]))/i;

function block(reason) {
  process.stderr.write(
    `Blocked by .claude/hooks/block-env.mjs: ${reason}. ` +
      '.env files hold secrets and are off-limits to Claude Code in this project. ' +
      'Read .env.example for the variable names; if you need a real value, ask the user. ' +
      'Do not try to work around this block.\n',
  );
  process.exit(2);
}

function isEnvPath(path, cwd) {
  if (typeof path !== 'string' || path === '') return false;
  const absolute = resolve(cwd, path);
  const candidates = [absolute];
  try {
    candidates.push(realpathSync(absolute)); // a symlink pointing at .env counts as .env
  } catch {
    // Path does not exist yet (e.g. Write creating it); the name check alone applies.
  }
  return candidates.some((candidate) => {
    const name = basename(candidate);
    return ENV_NAME.test(name) && !ALLOWED_NAMES.has(name.toLowerCase());
  });
}

const mentionsEnv = (text) => typeof text === 'string' && ENV_TOKEN.test(text);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  block('could not parse hook input, failing closed');
}

const tool = input.tool_name;
const toolInput = input.tool_input ?? {};
const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();

switch (tool) {
  case 'Read':
  case 'Edit':
  case 'Write':
  case 'MultiEdit':
    if (isEnvPath(toolInput.file_path, cwd)) block(`${tool} of ${toolInput.file_path}`);
    break;
  case 'NotebookEdit':
    if (isEnvPath(toolInput.notebook_path, cwd)) block(`${tool} of ${toolInput.notebook_path}`);
    break;
  case 'Grep':
    if (isEnvPath(toolInput.path, cwd)) block(`Grep in ${toolInput.path}`);
    if (mentionsEnv(toolInput.glob)) block(`Grep with glob ${toolInput.glob}`);
    break;
  case 'Glob':
    if (isEnvPath(toolInput.path, cwd)) block(`Glob in ${toolInput.path}`);
    if (mentionsEnv(toolInput.pattern)) block(`Glob with pattern ${toolInput.pattern}`);
    break;
  case 'Bash':
    if (mentionsEnv(toolInput.command)) block('Bash command references a .env file');
    break;
}

process.exit(0);
