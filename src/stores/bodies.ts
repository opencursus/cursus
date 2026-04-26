import { create } from "zustand";
import { ipc, type Attachment, type UnsubscribeInfo } from "@/lib/ipc";
import {
  getAccount,
  getAccountSecrets,
  getMessageBody,
  setMessageBody,
  upsertSearchBody,
} from "@/lib/db";
import { useAccountsStore } from "@/stores/accounts";

export interface BodyState {
  html: string | null;
  text: string | null;
  attachments: Attachment[];
  unsubscribe: UnsubscribeInfo | null;
}

interface BodiesStore {
  bodies: Record<number, BodyState>;
  loading: Record<number, boolean>;
  errors: Record<number, string | null>;
  fetchBody: (accountId: number, folderPath: string, uid: number) => Promise<void>;
  clear: () => void;
}

function folderIdFor(accountId: number, folderPath: string): number | null {
  const f = useAccountsStore
    .getState()
    .folders.find((x) => x.accountId === accountId && x.path === folderPath);
  return f && f.id > 0 ? f.id : null;
}

export const useBodiesStore = create<BodiesStore>((set, get) => ({
  bodies: {},
  loading: {},
  errors: {},
  fetchBody: async (accountId, folderPath, uid) => {
    if (get().bodies[uid]) return; // cached for this session

    // Phase 1: hit the DB. If we already have the body persisted, skip the
    // round-trip entirely. Cold-start instant for any message previously
    // opened — and for messages that never need re-fetching at all.
    const folderId = folderIdFor(accountId, folderPath);
    if (folderId != null) {
      try {
        const cached = await getMessageBody(folderId, uid);
        if (cached) {
          let attachments: Attachment[] = [];
          if (cached.attachments) {
            try {
              attachments = JSON.parse(cached.attachments) as Attachment[];
            } catch {
              attachments = [];
            }
          }
          set((s) => ({
            bodies: {
              ...s.bodies,
              [uid]: {
                html: cached.html,
                text: cached.text,
                attachments,
                unsubscribe: null,
              },
            },
          }));
          return;
        }
      } catch (err) {
        console.warn("getMessageBody failed", err);
      }
    }

    // Phase 2: round-trip IMAP.
    set((s) => ({ loading: { ...s.loading, [uid]: true }, errors: { ...s.errors, [uid]: null } }));
    try {
      const account = await getAccount(accountId);
      if (!account) throw new Error(`account ${accountId} not found`);
      const secrets = await getAccountSecrets(accountId);

      const body = await ipc.imapFetchMessageBody(
        {
          host: account.imap_host,
          port: account.imap_port,
          username: account.imap_username ?? account.email,
          password: secrets.imapPassword,
          security: account.imap_security,
        },
        folderPath,
        uid,
      );

      const attachments = body.attachments ?? [];
      set((s) => ({
        bodies: {
          ...s.bodies,
          [uid]: {
            html: body.html,
            text: body.text,
            attachments,
            unsubscribe: body.unsubscribe ?? null,
          },
        },
        loading: { ...s.loading, [uid]: false },
      }));

      // Phase 3: persist body for next cold-start. Only when we have a real
      // folder row (synthetic folders carry negative ids — those would
      // violate the FK).
      if (folderId != null) {
        void setMessageBody(
          folderId,
          uid,
          body.html,
          body.text,
          attachments.length > 0 ? JSON.stringify(attachments) : null,
        ).catch((err) => console.warn("setMessageBody failed", err));
      }

      // Fill the search index with the body so full-text search now covers
      // this message. Prefer the plain-text extracted by mail-parser; fall
      // back to stripped HTML if only that is available.
      const textForIndex =
        body.text && body.text.length > 0
          ? body.text
          : body.html
            ? body.html
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim()
            : "";
      if (textForIndex) {
        void upsertSearchBody(accountId, folderPath, uid, textForIndex).catch(
          () => {},
        );
      }
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [uid]: false },
        errors: { ...s.errors, [uid]: String(err) },
      }));
    }
  },
  clear: () => set({ bodies: {}, loading: {}, errors: {} }),
}));
