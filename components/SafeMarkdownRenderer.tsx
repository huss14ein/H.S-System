import React from 'react';

/** Semantic header → Tailwind classes for colorful AI content */
const headerStyles: Record<string, string> = {
    positive: 'text-green-800 border-l-4 border-green-500 bg-green-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    highlight: 'text-green-800 border-l-4 border-green-500 bg-green-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    attention: 'text-amber-800 border-l-4 border-amber-500 bg-amber-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    watch: 'text-amber-800 border-l-4 border-amber-500 bg-amber-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    caution: 'text-amber-800 border-l-4 border-amber-500 bg-amber-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    recommendation: 'text-violet-800 border-l-4 border-violet-500 bg-violet-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    strategic: 'text-violet-800 border-l-4 border-violet-500 bg-violet-50/80 pl-3 py-1.5 -ml-3 rounded-r',
    summary: 'text-slate-800 border-l-4 border-primary bg-primary/5 pl-3 py-1.5 -ml-3 rounded-r',
    overall: 'text-slate-800 border-l-4 border-primary bg-primary/5 pl-3 py-1.5 -ml-3 rounded-r',
    status: 'text-slate-800 border-l-4 border-primary bg-primary/5 pl-3 py-1.5 -ml-3 rounded-r',
    default: 'text-slate-800 font-semibold',
};

function getHeaderStyle(title: string): string {
    const lower = title.toLowerCase();
    if (/\b(positive|highlights?|well done|strength|strengths)\b/.test(lower)) return headerStyles.positive;
    if (/\b(attention|watch|caution|areas to watch|risk|detractor|weakness|threats?)\b/.test(lower)) return headerStyles.attention;
    if (/\b(recommendation|strategic|next step|action|suggestion|tip|opportunities|rebalancing|concept to research)\b/.test(lower)) return headerStyles.recommendation;
    if (/\b(overall|summary|status|health|insight|spending insight|on track|concentration|resilience)\b/.test(lower)) return headerStyles.summary;
    return headerStyles.default;
}

const SafeMarkdownRenderer: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];
    let lastHeaderStyle: string | null = null;

    const flushList = () => {
        if (listItems.length > 0) {
            const wrapClass = lastHeaderStyle === headerStyles.positive
                ? 'bg-green-50/50 rounded-lg pl-4 pr-3 py-2 border border-green-100'
                : lastHeaderStyle === headerStyles.attention
                    ? 'bg-amber-50/50 rounded-lg pl-4 pr-3 py-2 border border-amber-100'
                    : lastHeaderStyle === headerStyles.recommendation
                        ? 'bg-violet-50/50 rounded-lg pl-4 pr-3 py-2 border border-violet-100'
                        : '';
            elements.push(
                <ul key={`ul-${elements.length}`} className={`list-disc pl-5 space-y-1.5 text-gray-700 ${wrapClass}`}>
                    {listItems}
                </ul>
            );
            listItems = [];
        }
    };

    const parseInline = (text: string) => {
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    lines.forEach((line, index) => {
        const trimmed = line.trim();

        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            listItems.push(
                <li key={`li-${index}`} className="text-gray-700">
                    {parseInline(trimmed.substring(2))}
                </li>
            );
            return;
        }

        flushList();

        if (trimmed.startsWith('#### ')) {
            lastHeaderStyle = null;
            elements.push(<h4 key={index} className="font-semibold text-slate-700 text-sm mt-3 mb-1">{trimmed.substring(5)}</h4>);
            return;
        }
        if (trimmed.startsWith('### ')) {
            const title = trimmed.substring(4);
            lastHeaderStyle = getHeaderStyle(title);
            elements.push(<h3 key={index} className={`font-semibold text-base mt-4 mb-2 first:mt-0 ${lastHeaderStyle}`}>{title}</h3>);
            return;
        }
        if (trimmed.startsWith('## ')) {
            lastHeaderStyle = null;
            elements.push(<h2 key={index} className="font-bold text-lg text-primary mt-4 mb-2 border-b border-primary/20 pb-1">{trimmed.substring(3)}</h2>);
            return;
        }
        if (trimmed.startsWith('> ')) {
            elements.push(<blockquote key={index} className="border-l-4 border-primary/50 bg-slate-50 pl-4 py-2 my-2 rounded-r text-gray-700 italic">{parseInline(trimmed.substring(2))}</blockquote>);
            return;
        }
        if (trimmed !== '') {
            lastHeaderStyle = null;
            elements.push(<p key={index} className="text-gray-700 leading-relaxed">{parseInline(line)}</p>);
        }
    });

    flushList();

    return (
        <div className={`prose prose-sm max-w-none text-gray-700 ${className}`}>
            {elements}
        </div>
    );
};

export default SafeMarkdownRenderer;
