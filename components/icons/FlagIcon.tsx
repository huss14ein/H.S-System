import React from 'react';

export const FlagIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 6h18M7.5 3v1.5M7.5 21v-6m0 6h10.5m0-6V3.75c0-.621-.504-1.125-1.125-1.125H4.125A1.125 1.125 0 003 3.75v6.75" />
    </svg>
);
