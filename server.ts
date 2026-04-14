import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, model: modelName, responseMimeType, useSearch } = req.body;
      
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
      
      res.json({ text, groundingMetadata });
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
