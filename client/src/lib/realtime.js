import { supabase } from './supabaseClient';

// Debounced so a batch of inserts (e.g. multi-image upload) triggers one reload, not many.
export function subscribeToDataChanges(onChange, debounceMs = 300) {
  if (!supabase) {
    return () => {};
  }

  let timer = null;
  const scheduleReload = (payload) => {
    console.log('[realtime] change event:', payload?.table, payload?.eventType);
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  const channel = supabase
    .channel('kcq-data-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'modules' }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, scheduleReload)
    .subscribe((status, error) => {
      console.log('[realtime] channel status:', status, error || '');
    });

  return () => {
    clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}
