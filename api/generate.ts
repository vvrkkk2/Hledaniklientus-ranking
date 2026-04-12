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

    const model = modelName || 'gemini-1.5-flash';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent?key=${apiKey}`;

    const requestBody: any = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
          responseMimeType: responseMimeType || 'text/plain'
      }
    };

    if (useSearch) {
        requestBody.tools = [{ googleSearchRetrieval: {} }];
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error?.message || JSON.stringify(data));
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata;
    
    res.status(200).json({ text, groundingMetadata });
  } catch (error: any) {
    console.error("Vertex AI Error:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
}
