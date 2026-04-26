export type Theme = "light" | "dark" | "black" | "system";
export type ReadingPane = "right" | "bottom" | "off";
export type Density = "compact" | "comfortable" | "spacious";

export type MailCategory = "pinned" | "people" | "notifications" | "newsletters";

export interface Workspace {
  id: number;
  name: string;
  color: string;
}

export interface Account {
  id: number;
  email: string;
  displayName: string;
  color: string;
  workspaceId: number;
  unreadCount: number;
  signatureHtml: string | null;
}

export interface MailFolder {
  id: number;
  accountId: number;
  name: string;
  path: string;
  specialUse?: "inbox" | "sent" | "drafts" | "trash" | "archive" | "spam";
  unreadCount: number;
}

export interface Thread {
  id: number;
  accountId: number;
  folderId: number;
  subject: string;
  snippet: string;
  participants: string[];
  messageCount: number;
  hasUnread: boolean;
  isPinned: boolean;
  isImportant: boolean;
  hasAttachments: boolean;
  lastMessageAt: number;
  category: MailCategory | null;
}
