import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: { width: '16px', height: '16px', borderWidth: '2px' },
  md: { width: '24px', height: '24px', borderWidth: '3px' },
  lg: { width: '36px', height: '36px', borderWidth: '4px' },
} as const;

export const Spinner: React.FC<SpinnerProps> = ({ size = 'md', className = '' }) => {
  const s = sizes[size] ?? sizes.md;

  const style: React.CSSProperties = {
    width: s.width,
    height: s.height,
    border: `${s.borderWidth} solid var(--color-rule)`,
    borderTopColor: 'var(--admin-accent, var(--color-accent))',
    borderRadius: '50%',
    animation: 'gs-spin 0.6s linear infinite',
  };

  return (
    <>
      <style>{`@keyframes gs-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={style} className={className} />
    </>
  );
};
