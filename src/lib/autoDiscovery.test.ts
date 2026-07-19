import { describe, expect, it } from "vitest";
import { presetForEmail } from "@/lib/autoDiscovery";

describe("presetForEmail", () => {
  it("returns null when the address has no @", () => {
    expect(presetForEmail("not-an-email")).toBeNull();
  });

  it("maps gmail.com to the Gmail preset", () => {
    expect(presetForEmail("user@gmail.com")).toEqual({
      name: "Gmail",
      imap: { host: "imap.gmail.com", port: 993, security: "ssl" },
      smtp: { host: "smtp.gmail.com", port: 465, security: "ssl" },
    });
  });

  it("matches the domain case-insensitively", () => {
    expect(presetForEmail("USER@GMAIL.COM")?.name).toBe("Gmail");
  });

  it("maps alias domains to their canonical provider hosts", () => {
    const hotmail = presetForEmail("user@hotmail.com");
    expect(hotmail?.name).toBe("Hotmail");
    expect(hotmail?.imap.host).toBe("outlook.office365.com");
    expect(hotmail?.smtp).toEqual({
      host: "smtp.office365.com",
      port: 587,
      security: "starttls",
    });
  });

  it("uses the part after the LAST @ as the domain", () => {
    expect(presetForEmail('"odd@local"@gmail.com')?.name).toBe("Gmail");
  });

  it("falls back to a mail.{domain} SSL guess for unknown domains", () => {
    expect(presetForEmail("info@smallbiz.example")).toEqual({
      name: "smallbiz.example",
      imap: { host: "mail.smallbiz.example", port: 993, security: "ssl" },
      smtp: { host: "mail.smallbiz.example", port: 465, security: "ssl" },
    });
  });
});
