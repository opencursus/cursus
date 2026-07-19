// Update checker for the portable-exe distribution: query the newest GitHub
// release and compare against the compiled-in version. Callers decide how to
// surface the result (About section renders states; the startup check in
// App.tsx raises a toast).

export interface UpdateAvailable {
  current: string;
  latest: string;
  url: string;
  publishedAt: string;
}

// Use the listing endpoint (per_page=1) instead of /releases/latest because
// /latest excludes pre-releases. While we're shipping v0.1.x as previews,
// this is the only way the checker can detect a newer version.
const RELEASES_API =
  "https://api.github.com/repos/opencursus/cursus/releases?per_page=1";
export const REPO_URL = "https://github.com/opencursus/cursus";

export function isNewerSemver(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => Number(n) || 0);
  const b = current.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * Resolve to the newest release when it's ahead of the running version,
 * null when we're current (or no release exists yet). Network/API failures
 * throw — the caller chooses between surfacing and staying silent.
 */
export async function fetchAvailableUpdate(): Promise<UpdateAvailable | null> {
  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const list = (await res.json()) as Array<{
    tag_name?: string;
    html_url?: string;
    published_at?: string;
  }>;
  const release = Array.isArray(list) ? list[0] : undefined;
  if (!release) return null;
  const latest = String(release.tag_name ?? "").replace(/^v/, "");
  const current = __APP_VERSION__;
  if (!latest || !isNewerSemver(latest, current)) return null;
  return {
    current,
    latest,
    url: release.html_url ?? `${REPO_URL}/releases`,
    publishedAt: release.published_at ?? "",
  };
}
