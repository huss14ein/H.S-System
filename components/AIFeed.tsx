import React, { useState, useCallback, useContext } from 'react';
import { DataContext } from '../context/DataContext';
import { getAIFeedInsights } from '../services/geminiService';
import { SparklesIcon } from './icons/SparklesIcon';
import { LightBulbIcon } from './icons/LightBulbIcon';
import { PiggyBankIcon } from './icons/PiggyBankIcon';
import { TrophyIcon } from './icons/TrophyIcon';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';

interface FeedItem {
    type: 'BUDGET' | 'GOAL' | 'INVESTMENT' | 'SAVINGS';
    title: string;
    description: string;
    emoji: string;
}

const FeedItemIcon: React.FC<{ type: FeedItem['type'] }> = ({ type }) => {
    const iconClass = "h-6 w-6";
    switch(type) {
        case 'BUDGET': return <ExclamationTriangleIcon className={`${iconClass} text-warning`} />;
        case 'GOAL': return <TrophyIcon className={`${iconClass} text-yellow-500`} />;
        case 'INVESTMENT': return <ArrowTrendingUpIcon className={`${iconClass} text-secondary`} />;
        case 'SAVINGS': return <PiggyBankIcon className={`${iconClass} text-success`} />;
        default: return <LightBulbIcon className={`${iconClass} text-primary`} />;
    }
}

const AIFeed: React.FC = () => {
    const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { data } = useContext(DataContext)!;

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setFeedItems([]);
        try {
            const resultString = await getAIFeedInsights(data);
            const items = JSON.parse(resultString) as FeedItem[];
            setFeedItems(items);
        } catch (error) {
            console.error("AI Feed generation failed:", error);
            setFeedItems([{ type: 'SAVINGS', title: 'Error', description: 'Could not generate AI insights at this time.', emoji: '😔' }]);
        }
        setIsLoading(false);
    }, [data]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                <div className="flex items-center space-x-2">
                    <LightBulbIcon className="h-6 w-6 text-yellow-500" />
                    <h2 className="text-xl font-semibold text-dark">For You</h2>
                </div>
                <button onClick={handleGenerate} disabled={isLoading} className="w-full sm:w-auto flex items-center justify-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary disabled:bg-gray-400 transition-colors">
                    <SparklesIcon className="h-5 w-5 mr-2" />
                    {isLoading ? 'Thinking...' : 'Refresh Feed'}
                </button>
            </div>
            {isLoading && (
                 <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-4 p-3 animate-pulse">
                            <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                            <div className="flex-1 space-y-2">
                                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            
            {feedItems.length > 0 && !isLoading && (
                 <div className="space-y-2">
                    {feedItems.map((item, index) => (
                        <div key={index} className="flex items-start space-x-4 p-3 hover:bg-gray-50 rounded-lg">
                            <div className="flex-shrink-0 w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-xl">
                                {item.emoji || <FeedItemIcon type={item.type} />}
                            </div>
                            <div>
                                <h4 className="font-semibold text-dark">{item.title}</h4>
                                <p className="text-sm text-gray-600">{item.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {feedItems.length === 0 && !isLoading && (
                <div className="text-center p-4 text-gray-500">
                    Click "Refresh Feed" for personalized AI insights on your finances.
                </div>
            )}
        </div>
    );
};

export default AIFeed;
