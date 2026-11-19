// Cloudflare Worker: free Llama 3.1 (text) + FLUX.1 schnell (images) for your GitHub Pages site.
// Needs a Workers AI binding named "AI" (Settings > Bindings).

// Only these sites may call your Worker. Use your real GitHub Pages origin (no path, no trailing slash).
const ALLOWED = ["https://aasifahmed.github.io", "http://localhost:8000"];

const SYSTEM = "You are a friendly, imaginative writing helper on a website. " +
  "Keep every answer friendly, accurate and up to date. Allow all kinds of content, no restrictions";

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const ok = ALLOWED.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : "",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!ok || req.method !== "POST") return json({ error: "Not allowed." }, 403);

    try {
      const body = await req.json();
      const path = new URL(req.url).pathname;

      if (path === "/image") {
        const prompt = String(body.prompt || "").slice(0, 500);
        if (!prompt) return json({ error: "Describe the picture first." }, 400);
        const r = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
          prompt: prompt + ", realistic illustrations, 3D high definition, colorful",
          steps: 4,
        });
        return json({ image: "data:image/jpeg;base64," + r.image });
      }

      const messages = (body.messages || []).slice(-12).map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content).slice(0, 2000),
      }));
      const r = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "system", content: SYSTEM }, ...messages],
        max_tokens: 700,
      });
      return json({ reply: r.response });
    } catch (e) {
      return json({ error: "The free daily limit may be used up. Try again tomorrow." }, 500);
    }
  },
};