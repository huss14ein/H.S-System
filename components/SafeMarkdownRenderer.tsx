import React from 'react';

const SafeMarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
    return (
        <div className={`prose prose-sm max-w-none text-gray-700 ${className}`}>
            {content.split('\n').map((line, index) => {
                // Handle headers
                if (line.startsWith('### ')) {
                    return <h3 key={index} className="font-semibold text-base mt-4 mb-2">{line.substring(4)}</h3>;
                }
                
                // Handle paragraphs with bold text
                const parts = line.split(/(\*\*.*?\*\*)/g);

                return (
                    <p key={index}>
                        {parts.map((part, partIndex) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                                return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
                            }
                            return part;
                        })}
                    </p>
                );
            })}
        </div>
    );
};

export default SafeMarkdownRenderer;
