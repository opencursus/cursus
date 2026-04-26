import type { ImapSecurity, SmtpSecurity } from "@/lib/ipc";

export interface ProviderPreset {
  name: string;
  imap: { host: string; port: number; security: ImapSecurity };
  smtp: { host: string; port: number; security: SmtpSecurity };
}

// Known providers keyed by email domain (or alias domains mapped to canonical).
const PRESETS: Record<string, ProviderPreset> = {
  "gmail.com": {
    name: "Gmail",
    imap: { host: "imap.gmail.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.gmail.com", port: 465, security: "ssl" },
  },
  "outlook.com": {
    name: "Outlook",
    imap: { host: "outlook.office365.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
  },
  "hotmail.com": {
    name: "Hotmail",
    imap: { host: "outlook.office365.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
  },
  "yahoo.com": {
    name: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "ssl" },
  },
  "icloud.com": {
    name: "iCloud",
    imap: { host: "imap.mail.me.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  },
  "fastmail.com": {
    name: "FastMail",
    imap: { host: "imap.fastmail.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.fastmail.com", port: 465, security: "ssl" },
  },
  "zoho.com": {
    name: "Zoho",
    imap: { host: "imap.zoho.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.zoho.com", port: 465, security: "ssl" },
  },
  "aol.com": {
    name: "AOL",
    imap: { host: "imap.aol.com", port: 993, security: "ssl" },
    smtp: { host: "smtp.aol.com", port: 465, security: "ssl" },
  },
  "gmx.com": {
    name: "GMX",
    imap: { host: "imap.gmx.com", port: 993, security: "ssl" },
    smtp: { host: "mail.gmx.com", port: 587, security: "starttls" },
  },
};

export function presetForEmail(email: string): ProviderPreset | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const direct = PRESETS[domain];
  if (direct) return direct;

  // Generic guess for everything else: most small providers / cPanel-style
  // hosts expose both IMAP and SMTP on the same `mail.{domain}` host with
  // SSL/TLS (IMAP 993, SMTP 465). It's still a guess — user verifies via
  // Test-connection before saving.
  return {
    name: domain,
    imap: { host: `mail.${domain}`, port: 993, security: "ssl" },
    smtp: { host: `mail.${domain}`, port: 465, security: "ssl" },
  };
}
