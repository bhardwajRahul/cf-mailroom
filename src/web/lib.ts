const AVATAR_COLORS = [
  "bg-slate-200 text-slate-700",
  "bg-stone-200 text-stone-700",
  "bg-zinc-200 text-zinc-700",
  "bg-blue-50 text-blue-700",
];

export function avatarClass(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function initialOf(nameOrAddress: string): string {
  return (nameOrAddress.trim()[0] ?? "?").toUpperCase();
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export { splitQuotedTail } from "../shared/quote";
