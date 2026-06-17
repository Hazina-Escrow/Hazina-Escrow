import { useState, useCallback, useRef } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
}

type ToastInput = Omit<Toast, 'id'>;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = `toast-${++counterRef.current}`;
      const duration = input.duration ?? 4000;

      setToasts(prev => [...prev, { ...input, id, duration }]);

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }

      return id;
    },
    [dismiss],
  );

  const success = useCallback(
    (title: string, description?: string) => toast({ variant: 'success', title, description }),
    [toast],
  );

  const error = useCallback(
    (title: string, description?: string) => toast({ variant: 'error', title, description }),
    [toast],
  );

  const warning = useCallback(
    (title: string, description?: string) => toast({ variant: 'warning', title, description }),
    [toast],
  );

  const info = useCallback(
    (title: string, description?: string) => toast({ variant: 'info', title, description }),
    [toast],
  );

  return { toasts, toast, success, error, warning, info, dismiss };
}
