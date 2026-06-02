import { useEffect, useState } from "react";
import { CheckCircle, AlertCircle, X } from "lucide-react";
import clsx from "clsx";

export interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  duration?: number;
  onClose?: () => void;
}

export function Toast({
  message,
  type = "info",
  duration = 4000,
  onClose,
}: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (duration <= 0) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!isVisible) return null;

  const bgColor = {
    success: "bg-emerald-500/10 border-emerald-500/30",
    error: "bg-red-500/10 border-red-500/30",
    info: "bg-gold/10 border-gold/30",
  }[type];

  const textColor = {
    success: "text-emerald-400",
    error: "text-red-400",
    info: "text-gold",
  }[type];

  const Icon = {
    success: CheckCircle,
    error: AlertCircle,
    info: CheckCircle,
  }[type];

  return (
    <div
      className={clsx(
        "fixed bottom-6 right-6 max-w-sm rounded-xl border px-4 py-3 flex items-center gap-3 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300 z-50",
        bgColor,
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className={clsx("w-5 h-5 flex-shrink-0", textColor)} />
      <p className={clsx("text-sm font-body", textColor)}>{message}</p>
      <button
        onClick={() => setIsVisible(false)}
        className="ml-auto flex-shrink-0 text-foreground-muted hover:text-foreground transition-colors"
        aria-label="Close notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
