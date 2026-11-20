export interface MessageRow {
  id: string;
  pic: string;
  task: string;
}

export function renderMessage(template: string, row: MessageRow): string {
  return template
    .replaceAll("{id}", row.id)
    .replaceAll("{pic}", row.pic)
    .replaceAll("{task}", row.task);
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}
