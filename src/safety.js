export function safeUrl(value, origin, allowHttp = false) {
  const u = new URL(value, origin);
  if (
    u.origin !== new URL(origin).origin ||
    u.username ||
    u.password ||
    !['https:', ...(allowHttp ? ['http:'] : [])].includes(u.protocol)
  )
    throw Error(
      `Unsafe URL: expected ${new URL(origin).origin}; received ${u.origin}${u.pathname}. Check sitemap redirects and child sitemap hosts; credentials in URLs are not allowed.`,
    );
  u.hash = '';
  return u;
}
export function publicUrl(value) {
  try {
    const u = new URL(value);
    return u.origin + u.pathname;
  } catch {
    return '[invalid URL]';
  }
}
export function secret(name) {
  const v = process.env[name];
  if (!v) throw Error('Missing authentication environment variable');
  return v;
}
export function redact(value) {
  let s = String(value);
  for (const [k, v] of Object.entries(process.env))
    if (/PASS|TOKEN|SECRET|COOKIE|USER|STORAGE_STATE/i.test(k) && v?.length >= 3)
      s = s.split(v).join('[REDACTED]');
  return s;
}
