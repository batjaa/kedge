export function relativeTime(value: string | null): string {
  if (!value) return '';

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';

  const ms = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}
