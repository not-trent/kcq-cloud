export function formatDuration(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatYear(year?: number): string | undefined {
  return year && Number.isFinite(year) ? String(year) : undefined;
}

export function formatLicence(licence?: string): string | undefined {
  if (!licence) return undefined;
  const labels: Record<string, string> = {
    'all-rights-reserved': 'All rights reserved',
    'no-rights-reserved': 'No rights reserved',
    'cc-by': 'CC BY',
    'cc-by-sa': 'CC BY-SA',
    'cc-by-nc': 'CC BY-NC',
    'cc-by-nc-sa': 'CC BY-NC-SA',
    'cc-by-nd': 'CC BY-ND',
    'cc-by-nc-nd': 'CC BY-NC-ND',
  };
  return labels[licence] ?? licence;
}
