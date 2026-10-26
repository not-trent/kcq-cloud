import { useCallback, useEffect, useState } from 'react';
import { api, type ServerInfo } from '@/lib/api';

export type ServerStatus = 'checking' | 'online' | 'unreachable';

export interface ServerState {
  status: ServerStatus;
  info: ServerInfo | null;
  error: string | null;
  soundcloudConfigured: boolean;
  reload: () => void;
}

/** Asks the server which providers it has credentials for, so the UI never promises more than it can do. */
export function useServerInfo(): ServerState {
  const [status, setStatus] = useState<ServerStatus>('checking');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStatus('checking');
    api
      .serverInfo(controller.signal)
      .then((next) => {
        if (!active) return;
        setInfo(next);
        setStatus('online');
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setStatus('unreachable');
        setError(cause instanceof Error ? cause.message : 'Unknown error');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const soundcloud = info?.providers.find((provider) => provider.id === 'soundcloud');

  return {
    status,
    info,
    error,
    soundcloudConfigured: soundcloud?.configured ?? false,
    reload,
  };
}
