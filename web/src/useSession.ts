import { useEffect, useState } from 'react';
import type { SessionSnapshot } from '@vto/shared';

/** Live session over SSE; both devices see the same state (SPEC §6.3). */
export function useSession(): { session: SessionSnapshot | null; connected: boolean; setSession: (s: SessionSnapshot) => void } {
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      setSession(JSON.parse(e.data) as SessionSnapshot);
      setConnected(true);
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return { session, connected, setSession };
}

export function useIsLaptop(): boolean {
  const query = '(hover: hover) and (pointer: fine)';
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}
