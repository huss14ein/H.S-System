import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import Modal from './Modal';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Type, FunctionDeclaration, Blob } from '@google/genai';
import { DataContext } from '../context/DataContext';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { MicrophoneIcon } from './icons/MicrophoneIcon';

type Status = 'Inactive' | 'Connecting' | 'Listening' | 'Thinking' | 'Speaking' | 'Error';

interface TranscriptItem {
    source: 'user' | 'model';
    text: string;
}

const LiveAdvisorModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    const { data } = useContext(DataContext)!;
    const [status, setStatus] = useState<Status>('Inactive');
    const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
    
    const sessionRef = useRef<Promise<LiveSession> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

    const handleClose = () => {
        stopSession();
        onClose();
    };

    // Define functions that the AI can call
    const getNetWorth = useCallback(() => {
        const totalAssets = data.assets.reduce((sum, asset) => sum + asset.value, 0) + data.accounts.filter(a => a.balance > 0).reduce((sum, acc) => sum + acc.balance, 0);
        const totalLiabilities = data.liabilities.reduce((sum, liab) => sum + liab.amount, 0) + data.accounts.filter(a => a.balance < 0).reduce((sum, acc) => sum + acc.balance, 0);
        return { netWorth: totalAssets + totalLiabilities };
    }, [data]);

    const getBudgetStatus = useCallback(({ category }: { category: string }) => {
        const budget = data.budgets.find(b => b.category.toLowerCase() === category.toLowerCase());
        if (!budget) return { error: `Budget category "${category}" not found.` };
        
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const spent = data.transactions
            .filter(t => t.type === 'expense' && new Date(t.date) >= firstDayOfMonth && t.budgetCategory === budget.category)
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        
        return { limit: budget.limit, spent, remaining: budget.limit - spent };
    }, [data]);
    
     const getRecentTransactions = useCallback(({ limit }: { limit: number }) => {
        const sortedTransactions = [...data.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return { transactions: sortedTransactions.slice(0, limit).map(t => ({ description: t.description, amount: t.amount })) };
    }, [data]);

    const functionDeclarations: FunctionDeclaration[] = [
        { name: 'getNetWorth', parameters: { type: Type.OBJECT, properties: {} } },
        { name: 'getBudgetStatus', parameters: { type: Type.OBJECT, properties: { category: { type: Type.STRING } }, required: ['category'] } },
        { name: 'getRecentTransactions', parameters: { type: Type.OBJECT, properties: { limit: { type: Type.NUMBER } }, required: ['limit'] } },
    ];
    
    const functionHandlers: Record<string, (args: any) => any> = {
        getNetWorth,
        getBudgetStatus,
        getRecentTransactions,
    };

    const startSession = async () => {
        if (sessionRef.current) return;
        setStatus('Connecting');
        setTranscript([]);
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
            
            // FIX: Cast window to `any` to allow access to `webkitAudioContext` for older browsers without causing a TypeScript error.
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            nextStartTimeRef.current = 0;

            sessionRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    tools: [{ functionDeclarations }],
                },
                callbacks: {
                    onopen: () => {
                        setStatus('Listening');
                        // FIX: Cast window to `any` to allow access to `webkitAudioContext` for older browsers without causing a TypeScript error.
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
                        };
                        
                        mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(audioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         if (message.serverContent) {
                            if (message.serverContent.inputTranscription?.text) {
                                setTranscript(prev => {
                                    const last = prev[prev.length - 1];
                                    if (last?.source === 'user') {
                                        return [...prev.slice(0, -1), { source: 'user', text: last.text + message.serverContent.inputTranscription!.text }];
                                    }
                                    return [...prev, { source: 'user', text: message.serverContent.inputTranscription!.text }];
                                });
                            }
                             if (message.serverContent.outputTranscription?.text) {
                                setStatus('Speaking');
                                 setTranscript(prev => {
                                    const last = prev[prev.length - 1];
                                    if (last?.source === 'model') {
                                        return [...prev.slice(0, -1), { source: 'model', text: last.text + message.serverContent.outputTranscription!.text }];
                                    }
                                    return [...prev, { source: 'model', text: message.serverContent.outputTranscription!.text }];
                                });
                            }

                            const audioData = message.serverContent.modelTurn?.parts[0]?.inlineData.data;
                            if (audioData && outputAudioContextRef.current) {
                                const ctx = outputAudioContextRef.current;
                                const nextStartTime = Math.max(nextStartTimeRef.current, ctx.currentTime);
                                const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
                                const source = ctx.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(ctx.destination);
                                source.start(nextStartTime);
                                nextStartTimeRef.current = nextStartTime + audioBuffer.duration;
                                sourcesRef.current.add(source);
                                source.onended = () => {
                                    sourcesRef.current.delete(source);
                                    if (sourcesRef.current.size === 0) setStatus('Listening');
                                };
                            }
                         } else if (message.toolCall) {
                             setStatus('Thinking');
                             for (const fc of message.toolCall.functionCalls) {
                                 const handler = functionHandlers[fc.name];
                                 if (handler) {
                                     const result = handler(fc.args);
                                     sessionRef.current?.then(session => session.sendToolResponse({
                                         functionResponses: { id: fc.id, name: fc.name, response: { result: JSON.stringify(result) } }
                                     }));
                                 }
                             }
                         }
                    },
                    onerror: (e) => {
                        console.error('Live session error:', e);
                        setStatus('Error');
                    },
                    onclose: () => {},
                }
            });

        } catch (err) {
            console.error('Failed to start session', err);
            setStatus('Error');
        }
    };

    const stopSession = () => {
        if (!sessionRef.current) return;
        
        sessionRef.current.then(session => session.close());
        sessionRef.current = null;
        
        mediaStreamSourceRef.current?.disconnect();
        scriptProcessorRef.current?.disconnect();
        audioContextRef.current?.close();
        
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        
        outputAudioContextRef.current?.close();

        setStatus('Inactive');
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Live AI Advisor">
            <div className="flex flex-col h-[60vh]">
                <div className="flex-grow bg-gray-100 rounded-lg p-4 overflow-y-auto space-y-4">
                    {transcript.map((item, index) => (
                        <div key={index} className={`flex ${item.source === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-xs md:max-w-md p-3 rounded-lg ${item.source === 'user' ? 'bg-primary text-white' : 'bg-white'}`}>
                                {item.text}
                            </div>
                        </div>
                    ))}
                    {transcript.length === 0 && <p className="text-center text-gray-500">Press Start to begin your session.</p>}
                </div>
                <div className="flex-shrink-0 pt-4 text-center">
                    <p className="text-sm text-gray-500 font-medium mb-2">Status: {status}</p>
                    <button 
                        onClick={status === 'Inactive' || status === 'Error' ? startSession : stopSession}
                        className={`px-6 py-3 rounded-full text-white font-semibold transition-colors ${status === 'Inactive' || status === 'Error' ? 'bg-primary hover:bg-secondary' : 'bg-red-600 hover:bg-red-700'}`}
                    >
                       {status === 'Inactive' || status === 'Error' ? 'Start Session' : 'Stop Session'}
                    </button>
                    {(status === 'Listening' || status === 'Speaking') && 
                        <div className="flex items-center justify-center space-x-2 mt-3 text-gray-600">
                           <MicrophoneIcon className="h-5 w-5 animate-pulse-live"/> <span>Live</span>
                        </div>
                    }
                </div>
            </div>
        </Modal>
    );
};

export default LiveAdvisorModal;