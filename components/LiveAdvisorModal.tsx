import React, { useState, useRef, useContext, useCallback } from 'react';
import Modal from './Modal';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration, Blob as GenaiBlob } from '@google/genai';
import { DataContext } from '../context/DataContext';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { HeadsetIcon } from './icons/HeadsetIcon';

type Status = 'Inactive' | 'Connecting' | 'Listening' | 'Thinking' | 'Speaking' | 'Error';

interface TranscriptItem {
    source: 'user' | 'model' | 'system';
    text: string;
}

const audioProcessorString = `
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this._buffer = new Float32Array(this.bufferSize);
    this._bytesWritten = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input[0];

    if (channel) {
      // It's possible to receive a block larger than our buffer size.
      // We process the data in chunks of our buffer size.
      let data = new Float32Array(channel);
      let dataLeft = data.length;
      let dataIndex = 0;

      while (dataLeft > 0) {
        const spaceLeft = this.bufferSize - this._bytesWritten;
        const toWrite = Math.min(dataLeft, spaceLeft);
        
        this._buffer.set(data.subarray(dataIndex, dataIndex + toWrite), this._bytesWritten);
        this._bytesWritten += toWrite;
        dataIndex += toWrite;
        dataLeft -= toWrite;

        if (this._bytesWritten === this.bufferSize) {
          this.port.postMessage(this._buffer);
          this._bytesWritten = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
`;


const LiveAdvisorModal: React.FC<{ isOpen: boolean; onClose: () => void; }> = ({ isOpen, onClose }) => {
    const { data, addWatchlistItem } = useContext(DataContext)!;
    const [status, setStatus] = useState<Status>('Inactive');
    const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
    const [view, setView] = useState<'welcome' | 'chat'>('welcome');
    
    const sessionRef = useRef<Promise<any> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef(0);
    const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

    const handleClose = () => {
        stopSession();
        setView('welcome');
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
    
    const handleAddWatchlistItem = useCallback(async ({ symbol, name }: { symbol: string, name: string }) => {
        if (!symbol || !name) return { success: false, error: "Symbol and name are required." };
        try {
            await addWatchlistItem({ symbol, name });
            return { success: true, message: `Successfully added ${name} to the watchlist.` };
        } catch (e) {
            console.error("Error adding to watchlist via AI:", e);
            return { success: false, error: `Failed to add ${name} to watchlist.` };
        }
    }, [addWatchlistItem]);

    const functionDeclarations: FunctionDeclaration[] = [
        { name: 'getNetWorth', parameters: { type: Type.OBJECT, properties: {} } },
        { name: 'getBudgetStatus', parameters: { type: Type.OBJECT, properties: { category: { type: Type.STRING } }, required: ['category'] } },
        { name: 'getRecentTransactions', parameters: { type: Type.OBJECT, properties: { limit: { type: Type.NUMBER } }, required: ['limit'] } },
        { name: 'addWatchlistItem', description: "Adds a stock to the user's watchlist.", parameters: { type: Type.OBJECT, properties: { symbol: { type: Type.STRING, description: "The stock ticker symbol, e.g., MSFT or 2222.SR" }, name: { type: Type.STRING, description: "The full name of the company, e.g., Microsoft Corp." } }, required: ['symbol', 'name'] } },
    ];
    
    const functionHandlers: Record<string, (args: any) => any> = {
        getNetWorth,
        getBudgetStatus,
        getRecentTransactions,
        addWatchlistItem: handleAddWatchlistItem,
    };

    const startSession = async () => {
        if (sessionRef.current) return;
        setStatus('Connecting');
        setTranscript([]);

        // FIX: API key must be retrieved from process.env.API_KEY per coding guidelines.
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            setStatus('Error');
            console.error("Live Advisor is unavailable: API_KEY environment variable not set.");
            alert("Live Advisor is unavailable: API Key not found.");
            return;
        }
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey });
            
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            nextStartTimeRef.current = 0;

            sessionRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction: "You are 'HS', a friendly and highly capable AI financial assistant. You can answer questions about the user's finances by calling functions. You can also manage their watchlist by adding stocks when they ask. Be concise and helpful.",
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    tools: [{ functionDeclarations }],
                },
                callbacks: {
                    onopen: async () => {
                        setStatus('Listening');
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        
                        const blob = new Blob([audioProcessorString], { type: 'application/javascript' });
                        const blobUrl = URL.createObjectURL(blob);
                        await audioContextRef.current.audioWorklet.addModule(blobUrl);

                        mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
                        const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
                        audioWorkletNodeRef.current = workletNode;
                        
                        workletNode.port.onmessage = (event) => {
                            const inputData = event.data; // This is a Float32Array
                            const pcmBlob: GenaiBlob = {
                                data: encode(new Uint8Array(new Int16Array(inputData.map((x: number) => x * 32768)).buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
                        };
                        
                        mediaStreamSourceRef.current.connect(workletNode);
                        workletNode.connect(audioContextRef.current.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         if (message.serverContent) {
                            setTranscript(prev => prev.filter(item => item.source !== 'system'));

                            const inputText = message.serverContent.inputTranscription?.text;
                            if (inputText) {
                                setTranscript(prev => {
                                    if (prev.length > 0) {
                                        const last = prev[prev.length - 1];
                                        if (last && last.source === 'user') {
                                            return [...prev.slice(0, -1), { ...last, text: last.text + inputText }];
                                        }
                                    }
                                    return [...prev, { source: 'user', text: inputText }];
                                });
                            }
                            
                            const outputText = message.serverContent.outputTranscription?.text;
                             if (outputText) {
                                setStatus('Speaking');
                                 setTranscript(prev => {
                                    if (prev.length > 0) {
                                        const last = prev[prev.length - 1];
                                        if (last && last.source === 'model') {
                                            return [...prev.slice(0, -1), { ...last, text: last.text + outputText }];
                                        }
                                    }
                                    return [...prev, { source: 'model', text: outputText }];
                                });
                            }

                            const audioData = message.serverContent.modelTurn?.parts?.[0]?.inlineData?.data;
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
                             const functionCalls = message.toolCall.functionCalls ?? [];
                             const toolCallDescription = functionCalls.map(fc => {
                                 const args = JSON.stringify(fc.args);
                                 return `${fc.name}(${args !== '{}' ? args : ''})`;
                             }).join(', ');
                             setTranscript(prev => [...prev, { source: 'system', text: `Executing: ${toolCallDescription}` }]);
                             
                             for (const fc of functionCalls) {
                                if (fc && fc.name) {
                                    const handler = functionHandlers[fc.name];
                                    if (handler) {
                                        const result = await handler(fc.args);
                                        sessionRef.current?.then(session => session.sendToolResponse({
                                            functionResponses: { id: fc.id, name: fc.name, response: { result: JSON.stringify(result) } }
                                        }));
                                    }
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
        audioWorkletNodeRef.current?.disconnect();
        audioWorkletNodeRef.current = null;
        
        audioContextRef.current?.close();
        
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        
        outputAudioContextRef.current?.close();

        setStatus('Inactive');
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Live AI Advisor">
            {view === 'welcome' ? (
                <div className="text-center p-4">
                    <HeadsetIcon className="h-16 w-16 mx-auto text-primary opacity-50 mb-4" />
                    <h3 className="text-lg font-semibold text-dark">Speak with your AI Assistant</h3>
                    <p className="text-sm text-gray-600 mt-2 max-w-sm mx-auto">
                        Get real-time answers about your accounts, budgets, and investments. 
                        Your conversation is private and will not be saved.
                    </p>
                    <button 
                        onClick={() => setView('chat')}
                        className="mt-6 px-6 py-3 bg-primary text-white font-semibold rounded-full hover:bg-secondary transition-colors"
                    >
                        Activate Live Session
                    </button>
                </div>
            ) : (
                <div className="flex flex-col h-[60vh]">
                    <div className="flex-grow bg-gray-100 rounded-lg p-4 overflow-y-auto space-y-4">
                        {transcript.map((item, index) => (
                            <div key={index} className={`flex ${item.source === 'user' ? 'justify-end' : 'justify-start'}`}>
                               {item.source === 'system' ? (
                                    <div className="text-sm text-gray-500 italic flex items-center gap-2 p-2">
                                        <SparklesIcon className="h-4 w-4 animate-pulse" /> {item.text}
                                    </div>
                               ) : (
                                    <div className={`max-w-xs md:max-w-md p-3 rounded-lg ${item.source === 'user' ? 'bg-primary text-white' : 'bg-white shadow-sm'}`}>
                                        {item.text}
                                    </div>
                               )}
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
            )}
        </Modal>
    );
};

export default LiveAdvisorModal;