import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { requireUser } from './serverSecurity.ts';

type Generate = (instruction: string, prompt: string) => Promise<string | undefined>;

export function analysisEndpoint(generate: Generate, authenticate: RequestHandler = requireUser) {
  const router = express.Router();
  // Parse only the authenticated endpoint. No other route needs a JSON body.
  router.post('/', authenticate, express.json({ limit: '256kb', inflate: false }), async (req, res) => {
    const { systemInstruction, prompt } = req.body ?? {};
    if (typeof systemInstruction !== 'string' || !systemInstruction.trim() || systemInstruction.length > 32000 ||
        typeof prompt !== 'string' || !prompt.trim() || prompt.length > 65536) {
      res.status(400).json({ error: '입력 내용과 길이를 확인해주세요.' });
      return;
    }
    try {
      const text = await generate(systemInstruction, prompt);
      res.json({ text });
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      // Provider errors can contain request URLs, credentials or patient input.
      console.error('AI provider request failed', typeof status === 'number' ? status : 'unavailable');
      if (status === 429) { res.status(429).json({ error: '429: 요청이 많습니다.' }); return; }
      res.status(503).json({ error: '503: 응답을 생성하지 못했습니다.' });
    }
  });
  const invalidBody: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    res.status(status).json({ error: '요청 내용을 확인해주세요.' });
  };
  router.use(invalidBody);
  return router;
}
