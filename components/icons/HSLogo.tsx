import React from 'react';

// Finova brand mark: modern, premium gradient with a stylized "F" monogram.
export const HSLogo: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" {...props} className={`finova-logo ${props.className || ''}`}>
    <defs>
      <linearGradient id="finova-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#7c3aed" />
        <stop offset="50%" stopColor="#2563eb" />
        <stop offset="100%" stopColor="#06b6d4" />
      </linearGradient>
      <linearGradient id="finova-shine" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0.78" />
      </linearGradient>
    </defs>

    <rect x="8" y="8" width="84" height="84" rx="24" fill="url(#finova-gradient)" />
    <path d="M22 20 C32 12, 54 10, 72 18" fill="none" stroke="url(#finova-shine)" strokeWidth="6" strokeLinecap="round" opacity="0.4" />

    <path
      d="M34 28 H69 V39 H46 V47 H65 V57 H46 V72 H34 Z"
      fill="white"
    />
    <circle cx="70" cy="66" r="6" fill="white" opacity="0.92" />
  </svg>
);
