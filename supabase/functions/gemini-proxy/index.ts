import { GoogleGenAI, GenerateContentResponse } from "https://esm.sh/@google/genai@1.40.0";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// FIX: Add Deno type declaration to resolve "Cannot find name 'Deno'" error.
// This ensures the Supabase Edge Function, which runs on Deno, can be type-checked correctly.
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

// Basic CORS headers to allow requests from the web app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // This is an example of a basic CORS preflight handler.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { model, contents, config } = await req.json();
    const apiKey = Deno.env.get("GEMINI_API_KEY");

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not set in Supabase environment variables.");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // The client sends the parameters for generateContent (model, contents, config)
    const response: GenerateContentResponse = await ai.models.generateContent({ model, contents, config });

    // The SDK's response object is a class instance. Getters like `.text` are not
    // preserved when stringified. We must explicitly build a plain JSON object
    // to send back to the client.
    const result = {
        text: response.text,
        candidates: response.candidates,
        functionCalls: response.functionCalls,
    };
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in Gemini proxy function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});