import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests"
});

const validateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"] || req.query.api_key;
  const validKeys = (process.env.API_KEYS || "demo-key-123").split(",");

  if (!apiKey || !validKeys.includes(apiKey)) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }

  next();
};

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "tinyllama";

// Health check (no auth required)
app.get("/health", (req, res) => {
  res.json({ status: "ok", model: DEFAULT_MODEL, timestamp: new Date().toISOString() });
});

// Allow CORS preflight
app.options('*', cors());

// Get available models
app.get("/api/models", limiter, async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL.replace("/api/generate", "/api/tags")}`, {
      timeout: 5000
    });

    if (!response.ok) throw new Error("Failed to fetch models from Ollama");

    const data = await response.json();
    res.json({
      models: data.models?.map(m => ({ name: m.name, size: m.size })) || [],
      default: DEFAULT_MODEL
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Chat endpoint
app.post("/api/chat", limiter, async (req, res) => {
  const { prompt, model = DEFAULT_MODEL } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Prompt is required and must be a string" });
  }

  if (prompt.length > 5000) {
    return res.status(400).json({ error: "Prompt is too long (max 5000 characters)" });
  }

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false
      }),
      timeout: 300000
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();

    res.json({
      reply: data.response,
      model,
      prompt_tokens: data.prompt_eval_count,
      completion_tokens: data.eval_count,
      total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Agents endpoint
app.post("/api/agents", limiter, async (req, res) => {
  const { name, description, model = DEFAULT_MODEL, tools = [] } = req.body;

  if (!name) return res.status(400).json({ error: "Agent name required" });

  const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const agent = {
    id: agentId,
    name,
    description: description || "Custom AI Agent",
    model,
    tools,
    created_at: new Date().toISOString(),
    instruction: `You are ${name}, an AI agent. ${description || "Help the user with their requests."}`
  };

  res.status(201).json(agent);
});

// Get agents
app.get("/api/agents", limiter, (req, res) => {
  res.json({ agents: [], total: 0 });
});

// Chat with agent
app.post("/api/agents/:id/chat", limiter, async (req, res) => {
  const { message } = req.body;

  if (!message) return res.status(400).json({ error: "Message required" });

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt: message,
        stream: false
      }),
      timeout: 300000
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const data = await response.json();

    res.json({
      reply: data.response,
      agent_id: req.params.id,
      model: DEFAULT_MODEL,
      tool_calls: []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get tools
app.get("/api/tools", limiter, (req, res) => {
  res.json({
    available_tools: [
      { name: "web_search", description: "Search the web for information" },
      { name: "calculator", description: "Perform mathematical calculations" },
      { name: "get_time", description: "Get current time" },
      { name: "fetch_url", description: "Fetch content from a URL" }
    ]
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Vini AI Backend running on port ${PORT}`);
  console.log(`📦 Default Model: ${DEFAULT_MODEL}`);
  console.log(`🔗 Ollama URL: ${OLLAMA_URL}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
