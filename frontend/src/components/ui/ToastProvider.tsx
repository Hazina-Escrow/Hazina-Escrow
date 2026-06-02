import { createContext, useContext, type ReactNode } from 'react';
import { useToast, type Toast, type ToastVariant } from '../../hooks/useToast';
import ToastContainer from './ToastContainer';

interface ToastContextValue {
  toast: (input: Omit<Toast, 'id'>) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, toast, success, error, warning, info, dismiss } = useToast();

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToastContext(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastContext must be used inside ToastProvider');
  return ctx;
}

export type { ToastVariant };
