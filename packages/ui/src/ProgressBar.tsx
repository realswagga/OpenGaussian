import React from 'react';

interface ProgressBarProps {
  value: number;
  variant?: 'default' | 'success' | 'danger';
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

const variantColors: Record<string, { bar: string; track: string }> = {
  default: { bar: '#f5f5f5', track: '#2a2a2a' },
  success: { bar: '#22c55e', track: '#14532d' },
  danger: { bar: '#ef4444', track: '#661111' },
};

const sizes: Record<string, { height: number }> = {
  sm: { height: 4 },
  md: { height: 8 },
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  variant = 'default',
  size = 'md',
  label,
  className = '',
}) => {
  const clamped = Math.max(0, Math.min(100, value));
  const colors = variantColors[variant]!;
  const dims = sizes[size]!;

  const trackStyle: React.CSSProperties = {
    width: '100%',
    height: dims.height,
    borderRadius: dims.height / 2,
    background: colors.track,
    overflow: 'hidden',
  };

  const barStyle: React.CSSProperties = {
    height: '100%',
    width: `${clamped}%`,
    background: colors.bar,
    borderRadius: dims.height / 2,
    transition: 'width 300ms ease',
  };

  return (
    <div className={className} style={{ width: '100%' }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, color: '#a3a3a3' }}>
          <span>{label}</span>
          <span>{Math.round(clamped)}%</span>
        </div>
      )}
      <div style={trackStyle}>
        <div style={barStyle} />
      </div>
    </div>
  );
};
