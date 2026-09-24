// Terminal presentation: manual ANSI colors, no dependency. Colors auto-disable
// for non-TTY output and honor the NO_COLOR / FORCE_COLOR conventions.

/** Build a set of style functions. When `enabled` is false they are no-ops. */
export function makeStyler(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    enabled,
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

/** Decide whether to emit colors. Honors NO_COLOR and FORCE_COLOR conventions. */
export function colorEnabled(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR != null) return true;
  return Boolean(stream && stream.isTTY);
}
