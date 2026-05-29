import { useEffect, useState } from 'react';
import { getBuildSha } from '../utils/buildInfo';

const BUILD_SHA_META = /name="finova-build-sha"\s+content="([^"]+)"/i;

/** Detect when a cached SPA bundle is older than the live index.html on the server. */
export function useDeployFreshness(): { stale: boolean; remoteSha: string | null; localSha: string } {
  const localSha = getBuildSha();
  const [stale, setStale] = useState(false);
  const [remoteSha, setRemoteSha] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV || localSha === 'dev') return;

    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}?deploy-check=${Date.now()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!res.ok) return;
        const html = await res.text();
        const match = html.match(BUILD_SHA_META);
        const remote = match?.[1]?.trim() ?? null;
        if (cancelled || !remote) return;
        setRemoteSha(remote);
        if (remote !== localSha) setStale(true);
      } catch {
        // offline or blocked — ignore
      }
    };

    void check();
    const id = window.setInterval(check, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [localSha]);

  return { stale, remoteSha, localSha };
}
