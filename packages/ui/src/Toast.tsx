import React, { createContext, useContext, useState, useCallback } from 'react';

type ToastType = 'info' | 'success' | 'error' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = (): ToastContextValue => useContext(ToastContext);

const typeStyles: Record<ToastType, React.CSSProperties> = {
  info: { borderColor: 'var(--color-rule)', color: 'var(--admin-ink, var(--color-ink))' },
  success: { borderColor: 'var(--admin-success)', color: 'var(--admin-success)' },
  error: { borderColor: 'var(--admin-danger, var(--color-error))', color: 'var(--admin-danger, var(--color-error))' },
  warning: { borderColor: 'var(--admin-warning)', color: 'var(--admin-warning)' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let nextId = 0;

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 3000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '10px 16px',
              background: 'var(--admin-panel-popover, var(--color-panel-popover))',
              border: '1px solid',
              borderRadius: 8,
              fontSize: 14,
              minWidth: 240,
              maxWidth: 400,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              animation: 'gs-toast-in 250ms ease',
              ...typeStyles[t.type],
            }}
          >
            <span>{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--admin-muted, var(--color-muted))',
                cursor: 'pointer',
                fontSize: 16,
                padding: '0 0 0 12px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes gs-toast-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
};
