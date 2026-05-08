import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function generateWithRetry(modelId: string, systemInstruction: string, prompt: string, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelId,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.7,
            maxOutputTokens: 2000,
          },
        });
        return response.text;
      } catch (error: any) {
        if (error.message?.includes('429') && attempt < maxRetries) {
          console.warn(`Rate limit reached, retrying in ${attempt * 2}s...`);
          await sleep(attempt * 2000);
          continue;
        }
        throw error;
      }
    }
  }

  app.post('/api/generate-analysis', async (req, res) => {
    try {
      const { systemInstruction, prompt } = req.body;
      let text;
      try {
        text = await generateWithRetry('gemini-3-flash-preview', systemInstruction, prompt);
      } catch (err) {
        text = await generateWithRetry('gemini-3.1-pro-preview', systemInstruction, prompt);
      }
      res.json({ text });
    } catch (error: any) {
      console.error('API Error:', error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
