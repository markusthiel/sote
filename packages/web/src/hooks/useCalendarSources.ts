import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.js';

export function useCalendarSources(userId: string | undefined, place: string) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.calendarSources>>>();
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const out = await api.calendarSources();
      if (request !== generation.current) return;
      setData(out);
      setError(undefined);
    } catch (e) {
      if (request === generation.current) setError(e instanceof ApiError ? e.message : 'Kalender konnten nicht geladen werden.');
    }
  }, []);
  useEffect(() => {
    setData(undefined);
    setError(undefined);
    return () => { generation.current++; };
  }, [userId]);
  useEffect(() => {
    if (userId === undefined || (place !== 'calendar' && place !== 'calendar-sources')) return;
    void reload();
    // Ein Abruf läuft im Hintergrund. Auf der Quellenseite seinen Stand nachziehen.
    const timer = place === 'calendar-sources' ? window.setInterval(() => void reload(), 10000) : undefined;
    return () => { window.clearInterval(timer); generation.current++; };
  }, [userId, place, reload]);
  return { data, error, reload };
}
