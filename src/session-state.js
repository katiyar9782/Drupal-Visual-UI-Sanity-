// Runtime-only session material. Never put this map in a config or report.
const sessions = new Map();
export function setSessions(values = {}) {
  sessions.clear();
  for (const [env, value] of Object.entries(values)) sessions.set(env, value);
}
export function sessionFor(env, origin) {
  const value = sessions.get(env);
  if (!value || value.origin !== origin) throw Error('AUTH_REQUIRED');
  return value;
}
