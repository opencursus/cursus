import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  durationMs: number;
}

interface ToastsStore {
  toasts: Toast[];
  push: (input: {
    kind: ToastKind;
    message: string;
    action?: ToastAction;
    durationMs?: number;
  }) => number;
  /** In-place update of an existing toast (e.g. tick-down countdown). */
  update: (id: number, patch: Partial<Pick<Toast, "message" | "kind">>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const DEFAULT_TTL_MS = 3200;

export const useToastsStore = create<ToastsStore>((set, get) => ({
  toasts: [],
  push: ({ kind, message, action, durationMs = DEFAULT_TTL_MS }) => {
    const id = nextId++;
    const toast: Toast = { id, kind, message, action, durationMs };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (durationMs > 0) {
      setTimeout(() => get().dismiss(id), durationMs);
    }
    return id;
  },
  update: (id, patch) =>
    set((s) => ({
      toasts: s.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (message: string) =>
    useToastsStore.getState().push({ kind: "info", message }),
  success: (message: string) =>
    useToastsStore.getState().push({ kind: "success", message }),
  error: (message: string) =>
    useToastsStore.getState().push({ kind: "error", message }),
  push: (input: {
    kind: ToastKind;
    message: string;
    action?: ToastAction;
    durationMs?: number;
  }) => useToastsStore.getState().push(input),
  update: (id: number, patch: Partial<Pick<Toast, "message" | "kind">>) =>
    useToastsStore.getState().update(id, patch),
  dismiss: (id: number) => useToastsStore.getState().dismiss(id),
};
