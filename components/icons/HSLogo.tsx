
import React from 'react';

// A modern, abstract logo for H.S. combining geometric shapes.
export const HSLogo: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" {...props} className={`hs-logo ${props.className || ''}`}>
    <defs>
      <linearGradient id="hs-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" /> 
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
    </defs>
    {/* Base circle */}
    <circle cx="50" cy="50" r="45" fill="url(#hs-gradient)" className="logo-base" />
    {/* Abstract 'H' shape cut out */}
    <path d="M35 30 V70 H45 V55 H55 V70 H65 V30 H55 V45 H45 V30 Z" fill="white" className="logo-h-cutout" />
  </svg>
);
