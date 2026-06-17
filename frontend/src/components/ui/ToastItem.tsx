import { motion } from 'framer-motion';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';
import type { Toast, ToastVariant } from '../../hooks/useToast';

interface Props {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: React.ReactNode; border: string; iconColor: string; progressColor: string }
> = {
  success: {
    icon: <CheckCircle className="w-4 h-4" aria-hidden="true" />,
    border: 'border-emerald-500/30',
    iconColor: 'text-emerald-400',
    progressColor: 'bg-emerald-400',
  },
  error: {
    icon: <AlertCircle className="w-4 h-4" aria-hidden="true" />,
    border: 'border-red-500/30',
    iconColor: 'text-red-400',
    progressColor: 'bg-red-400',
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4" aria-hidden="true" />,
    border: 'border-amber-500/30',
    iconColor: 'text-amber-400',
    progressColor: 'bg-amber-400',
  },
  info: {
    icon: <Info className="w-4 h-4" aria-hidden="true" />,
    border: 'border-gold/30',
    iconColor: 'text-gold',
    progressColor: 'bg-gold',
  },
};

export default function ToastItem({ toast, onDismiss }: Props) {
  const styles = VARIANT_STYLES[toast.variant];
  const duration = toast.duration ?? 4000;

  return (
    <motion.div
      layout
      role="alert"
      aria-atomic="true"
      initial={{ opacity: 0, x: 48, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 48, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={clsx(
        'relative overflow-hidden rounded-2xl border',
        'bg-surface/80 backdrop-blur-md',
        'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
        styles.border,
      )}
    >
      {/* Progress bar */}
      {duration > 0 && (
        <motion.div
          className={clsx('absolute bottom-0 left-0 h-0.5', styles.progressColor)}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: duration / 1000, ease: 'linear' }}
        />
      )}

      <div className="flex items-start gap-3 p-4 pr-10">
        <span className={clsx('mt-0.5 flex-shrink-0', styles.iconColor)}>{styles.icon}</span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-body font-semibold text-foreground leading-snug">
            {toast.title}
          </p>
          {toast.description && (
            <p className="text-xs text-foreground-muted font-body mt-0.5 leading-relaxed">
              {toast.description}
            </p>
          )}
        </div>
      </div>

      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="absolute top-3 right-3 p-1 rounded-lg text-muted hover:text-foreground hover:bg-white/5 transition-colors"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </motion.div>
  );
}
