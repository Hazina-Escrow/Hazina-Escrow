import { Wifi, WifiOff, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '../../i18n';

interface WebSocketStatusProps {
  connected: boolean;
  error: string | null;
  className?: string;
}

/**
 * WebSocket connection status indicator
 * Shows a colored dot with tooltip indicating real-time connection status
 */
export function WebSocketStatus({ connected, error, className }: WebSocketStatusProps) {
  const { t } = useI18n();

  const getStatusText = () => {
    if (error) return t('websocket.error');
    if (connected) return t('websocket.connected');
    return t('websocket.disconnected');
  };

  const getStatusColor = () => {
    if (error) return 'text-red-400';
    if (connected) return 'text-emerald-400';
    return 'text-amber-400';
  };

  const getStatusBg = () => {
    if (error) return 'bg-red-400/10';
    if (connected) return 'bg-emerald-400/10';
    return 'bg-amber-400/10';
  };

  const getStatusIcon = () => {
    if (error) return AlertCircle;
    if (connected) return Wifi;
    return WifiOff;
  };

  const Icon = getStatusIcon();

  return (
    <div
      className={clsx(
        'group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200',
        getStatusBg(),
        getStatusColor(),
        'border-current/20',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={getStatusText()}
    >
      {/* Animated dot */}
      <span className="relative flex h-2 w-2">
        {connected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
        )}
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
      </span>

      {/* Icon */}
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />

      {/* Status text */}
      <span className="text-xs font-body font-medium">{getStatusText()}</span>

      {/* Tooltip on hover */}
      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-void border border-border rounded-lg text-xs font-body text-foreground-muted whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          {error}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-border"></div>
        </div>
      )}
    </div>
  );
}
