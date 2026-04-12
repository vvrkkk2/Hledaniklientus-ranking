import express from "express";
import { createServer as createViteServer } from "vite";
import { VertexAI } from '@google-cloud/vertexai';
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Initialize Vertex AI
  const vertexAI = new VertexAI({
    project: 'project-553f892f-9f62-4fe4-b22',
    location: 'us-central1'
  });

  app.post("/api/generate", async (req, res) => {
    try {
      const { prompt, model: modelName, responseMimeType, useSearch } = req.body;
      
      const tools = useSearch ? [{ googleSearchRetrieval: {} }] : undefined;

      const generativeModel = vertexAI.getGenerativeModel({
        model: modelName || 'gemini-1.5-flash',
        generationConfig: {
            responseMimeType: responseMimeType || 'text/plain'
        },
        tools: tools as any
      });

      const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      };

      const response = await generativeModel.generateContent(request);
      const text = response.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      
      // Extract grounding metadata if available
      const groundingMetadata = response.response.candidates?.[0]?.groundingMetadata;
      
      res.json({ text, groundingMetadata });
    } catch (error: any) {
      console.error("Vertex AI Error:", error);
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
