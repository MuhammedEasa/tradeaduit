// Reads an env var and strips what dashboards commonly paste in by accident:
// surrounding quotes, whitespace and stray newlines. A key with a quote in it produces
// "Authorization: Bearer \"sk-...\"", which providers reject with a confusing 401.
export function env(name: string): string {
  const raw = process.env[name];
  if (!raw) return "";
  return raw.trim().replace(/^['"]|['"]$/g, "").trim();
}
