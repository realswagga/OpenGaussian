import React from 'react';

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

const baseStyle: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #2a2a2a',
  borderRadius: '8px',
  padding: '16px',
  transition: 'border-color 150ms, background 150ms',
};

export const Card: React.FC<CardProps> = ({
  children,
  style,
  className = '',
  onClick,
  hoverable = false,
}) => {
  const mergedStyle: React.CSSProperties = {
    ...baseStyle,
    ...(hoverable ? { cursor: 'pointer' } : {}),
    ...style,
  };

  return (
    <div style={mergedStyle} className={className} onClick={onClick} onMouseEnter={hoverable ? (e) => {
      (e.currentTarget as HTMLDivElement).style.borderColor = '#3a3a3a';
      (e.currentTarget as HTMLDivElement).style.background = '#111111';
    } : undefined} onMouseLeave={hoverable ? (e) => {
      (e.currentTarget as HTMLDivElement).style.borderColor = '#2a2a2a';
      (e.currentTarget as HTMLDivElement).style.background = '#0d0d0d';
    } : undefined}>
      {children}
    </div>
  );
};