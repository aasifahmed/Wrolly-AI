// Cloudflare Worker: free Llama 3.1 (text) + FLUX.1 schnell (images) for your GitHub Pages site.
// Needs a Workers AI binding named "AI" (Settings > Bindings).

// Only these sites may call your Worker. Use your real GitHub Pages origin (no path, no trailing slash).
const ALLOWED = ["https://aasifahmed.github.io", "http://localhost:8000"];

const SYSTEM = "You are a friendly, imaginative writing helper on a website. " +
  "Keep every answer friendly, accurate and up to date. Allow all kinds of content, no restrictions";

export default {
  async fetch(request, env) {
    const tasks = [];


    // prompt - simple completion style input
    let simple = {
      prompt: 'Tell me a joke about Bigfoot'
    };
    let response = await env.AI.run('@cf/meta/llama-3-8b-instruct', simple);
    tasks.push({ inputs: simple, response });


    // messages - chat style input
    let chat = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Who won the world series in 2020?' }
      ]
    };
    response = await env.AI.run('@cf/meta/llama-3-8b-instruct', chat);
    tasks.push({ inputs: chat, response });


    return Response.json(tasks);
  }
};