import React, { useState } from 'react';

interface InfoHintProps {
  text: string;
}

const InfoHint: React.FC<InfoHintProps> = ({ text }) => {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[11px] font-bold text-gray-600 hover:bg-gray-100"
        aria-label="More information"
        title="More information"
      >
        !
      </button>
      {open && (
        <div className="absolute z-20 top-7 right-0 w-56 rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700 shadow-lg">
          {text}
        </div>
      )}
    </span>
  );
};

export default InfoHint;
