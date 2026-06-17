import { AnimatePresence } from 'framer-motion';
import type { Toast } from '../../hooks/useToast';
import ToastItem from './ToastItem';

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: Props) {
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 w-80 max-w-[calc(100vw-3rem)]"
    >
      <AnimatePresence initial={false}>
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
