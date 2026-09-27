export const fieldClass =
  'w-full rounded-xl border border-white/15 bg-[#171411] px-3 py-3 text-sm text-white outline-none focus:border-[#e5a93c] focus:ring-2 focus:ring-[#e5a93c]/25';
export const buttonClass =
  'min-h-11 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e5a93c] disabled:opacity-40 disabled:cursor-not-allowed';
export const primaryClass =
  buttonClass +
  ' bg-[#e5a93c] text-[#171411] hover:bg-[#f0ba58] border-transparent';
export type Settings = {
  enabled: boolean;
  host: string;
  port: 465 | 587;
  username: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  password_configured?: boolean;
};
export type Contact = {
  id: string;
  email: string;
  name: string;
  consent_source: string;
  consent_at: string;
  unsubscribed_at: string | null;
};
