import React from 'react';

const SafeMarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];

    const flushList = () => {
        if (listItems.length > 0) {
            elements.push(<ul key={`ul-${elements.length}`} className="list-disc pl-5 space-y-1">{listItems}</ul>);
            listItems = [];
        }
    };

    const parseLine = (line: string) => {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, partIndex) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    lines.forEach((line, index) => {
        // Handle lists
        if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
            listItems.push(
                <li key={`li-${index}`}>
                    {parseLine(line.trim().substring(2))}
                </li>
            );
            return;
        }

        flushList();

        // Handle headers
        if (line.startsWith('### ')) {
            elements.push(<h3 key={index} className="font-semibold text-base mt-4 mb-2">{line.substring(4)}</h3>);
        } else if (line.trim() !== '') { // Handle paragraphs, skip empty lines
            elements.push(
                <p key={index}>
                    {parseLine(line)}
                </p>
            );
        }
    });

    flushList(); // Flush any remaining list items at the end

    return (
        <div className={`prose prose-sm max-w-none text-gray-700 ${className}`}>
            {elements}
        </div>
    );
};

export default SafeMarkdownRenderer;