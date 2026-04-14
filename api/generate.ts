import { GoogleGenAI } from '@google/genai';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { prompt, model: modelName, responseMimeType, useSearch } = req.body;
    
    const projectId = 'project-553f892f-9f62-4fe4-b22';
    const location = 'us-central1';
    const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        return res.status(500).json({ error: "API Key is missing in environment variables." });
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = modelName || 'gemini-2.5-flash';

    const tools = useSearch ? [{ googleSearch: {} }] : undefined;

    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: responseMimeType || 'text/plain',
        tools: tools as any
      }
    });

    const text = response.text || "";
    const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
    
    res.status(200).json({ text, groundingMetadata });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
}
