// Stub Ollama HTTP for E2E tests. Returns a deterministic completion so the
// gateway -> provider -> claim flow can be asserted end-to-end without a GPU.
//
// Implements just enough of the Ollama HTTP surface to satisfy the
// t4t-provider's inference call: GET /api/tags and POST /api/chat.

const PORT = 11434;

Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/tags') {
      return Response.json({
        models: [
          {
            name: 'qwen2.5:0.5b',
            modified_at: new Date().toISOString(),
            size: 0,
            digest: 'mock',
            details: {
              format: 'gguf',
              family: 'qwen',
              parameter_size: '0.5B',
              quantization_level: 'Q4_0',
            },
          },
        ],
      });
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      return Response.json({
        model: 'qwen2.5:0.5b',
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'pong (mock-ollama)' },
        done: true,
        total_duration: 100_000_000,
        prompt_eval_count: 10,
        eval_count: 5,
      });
    }
    return new Response('not implemented', { status: 404 });
  },
});

console.log(`mock-ollama listening on :${PORT}`);
