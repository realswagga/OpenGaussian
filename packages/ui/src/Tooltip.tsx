import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

const tooltipBase: React.CSSProperties = {
  position: 'absolute',
  padding: '4px 8px',
  background: 'var(--admin-panel-popover, var(--color-panel-popover))',
  border: 'var(--admin-rule, 1px solid var(--color-rule))',
  borderRadius: '4px',
  color: 'var(--admin-ink, var(--color-ink))',
  fontSize: '12px',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  zIndex: 2000,
  transition: 'opacity 150ms',
};

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  delay = 300,
}) => {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const positionStyles: Record<string, React.CSSProperties> = {
    top: { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' },
    left: { right: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' },
    right: { left: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' },
  };

  const show = () => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div style={{ ...tooltipBase, ...positionStyles[position] }}>
          {content}
        </div>
      )}
    </div>
  );
};
