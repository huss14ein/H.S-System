
import React from 'react';

export const TrophyIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9a9.75 9.75 0 011.316-5.042 9.75 9.75 0 01-1.316-5.042h9a9.75 9.75 0 01-1.316 5.042 9.75 9.75 0 011.316 5.042a9.75 9.75 0 01-5.684 4.685A9.75 9.75 0 0112 21.75a9.75 9.75 0 01-5.684-4.685" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v1.125c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75v3.75" />
  </svg>
);
