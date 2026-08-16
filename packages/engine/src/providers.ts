export type ProviderType = "anthropic" | "openai-compat"

export interface ProviderDef {
	id: string
	name: string
	type: ProviderType
	baseURL?: string // only for openai-compat
	envKey: string // env variable name for the API key
	keyless?: boolean // gateway serves free models with no Authorization header
	models: ModelDef[]
}

export interface ModelDef {
	id: string
	name: string
	contextWindow: number
	supportsVision?: boolean
	supportsTools?: boolean
}

export const PROVIDERS: ProviderDef[] = [
	// ── Anthropic ─────────────────────────────────────────────────────────
	{
		id: "anthropic",
		name: "Anthropic",
		type: "anthropic",
		envKey: "ANTHROPIC_API_KEY",
		models: [
			{ id: "claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-opus-4-0", name: "Claude Opus 4", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-sonnet-4-0", name: "Claude Sonnet 4", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200000, supportsVision: true, supportsTools: true },
		],
	},

	// ── OpenAI ────────────────────────────────────────────────────────────
	{
		id: "openai",
		name: "OpenAI",
		type: "openai-compat",
		baseURL: "https://api.openai.com/v1",
		envKey: "OPENAI_API_KEY",
		models: [
			{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "gpt-4-turbo", name: "GPT-4 Turbo", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "o1", name: "o1", contextWindow: 200000, supportsTools: true },
			{ id: "o1-mini", name: "o1 Mini", contextWindow: 128000, supportsTools: true },
			{ id: "o3", name: "o3", contextWindow: 200000, supportsTools: true },
			{ id: "o3-mini", name: "o3 Mini", contextWindow: 200000, supportsTools: true },
			{ id: "o4-mini", name: "o4 Mini", contextWindow: 200000, supportsTools: true },
		],
	},

	// ── Google ────────────────────────────────────────────────────────────
	{
		id: "google",
		name: "Google",
		type: "openai-compat",
		baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
		envKey: "GOOGLE_API_KEY",
		models: [
			{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2000000, supportsVision: true, supportsTools: true },
			{ id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1000000, supportsVision: true, supportsTools: true },
		],
	},

	// ── Groq ─────────────────────────────────────────────────────────────
	{
		id: "groq",
		name: "Groq",
		type: "openai-compat",
		baseURL: "https://api.groq.com/openai/v1",
		envKey: "GROQ_API_KEY",
		models: [
			{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128000, supportsTools: true },
			{ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", contextWindow: 128000, supportsTools: true },
			{ id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextWindow: 32768, supportsTools: true },
			{ id: "gemma2-9b-it", name: "Gemma 2 9B", contextWindow: 8192, supportsTools: true },
			{ id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── Mistral ───────────────────────────────────────────────────────────
	{
		id: "mistral",
		name: "Mistral",
		type: "openai-compat",
		baseURL: "https://api.mistral.ai/v1",
		envKey: "MISTRAL_API_KEY",
		models: [
			{ id: "mistral-large-latest", name: "Mistral Large", contextWindow: 128000, supportsTools: true },
			{ id: "mistral-medium-latest", name: "Mistral Medium", contextWindow: 128000, supportsTools: true },
			{ id: "mistral-small-latest", name: "Mistral Small", contextWindow: 128000, supportsTools: true },
			{ id: "codestral-latest", name: "Codestral", contextWindow: 256000, supportsTools: true },
			{ id: "open-mistral-nemo", name: "Mistral Nemo", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── DeepSeek ──────────────────────────────────────────────────────────
	{
		id: "deepseek",
		name: "DeepSeek",
		type: "openai-compat",
		baseURL: "https://api.deepseek.com/v1",
		envKey: "DEEPSEEK_API_KEY",
		models: [
			{ id: "deepseek-chat", name: "DeepSeek V3", contextWindow: 64000, supportsTools: true },
			{ id: "deepseek-reasoner", name: "DeepSeek R1", contextWindow: 64000, supportsTools: true },
			{ id: "deepseek-coder", name: "DeepSeek Coder", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── Together AI ───────────────────────────────────────────────────────
	{
		id: "together",
		name: "Together AI",
		type: "openai-compat",
		baseURL: "https://api.together.xyz/v1",
		envKey: "TOGETHER_API_KEY",
		models: [
			{ id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", contextWindow: 131072, supportsTools: true },
			{ id: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", name: "Llama 3.1 405B", contextWindow: 130815, supportsTools: true },
			{ id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", name: "Llama 3.1 70B", contextWindow: 131072, supportsTools: true },
			{ id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B", contextWindow: 32768, supportsTools: true },
			{ id: "mistralai/Mixtral-8x22B-Instruct-v0.1", name: "Mixtral 8x22B", contextWindow: 65536, supportsTools: true },
			{ id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", contextWindow: 65536, supportsTools: true },
			{ id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 65536 },
		],
	},

	// ── Perplexity ────────────────────────────────────────────────────────
	{
		id: "perplexity",
		name: "Perplexity",
		type: "openai-compat",
		baseURL: "https://api.perplexity.ai",
		envKey: "PERPLEXITY_API_KEY",
		models: [
			{ id: "sonar-pro", name: "Sonar Pro", contextWindow: 200000, supportsTools: true },
			{ id: "sonar", name: "Sonar", contextWindow: 127072, supportsTools: true },
			{ id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro", contextWindow: 128000 },
			{ id: "sonar-reasoning", name: "Sonar Reasoning", contextWindow: 127072 },
		],
	},

	// ── Fireworks ─────────────────────────────────────────────────────────
	{
		id: "fireworks",
		name: "Fireworks AI",
		type: "openai-compat",
		baseURL: "https://api.fireworks.ai/inference/v1",
		envKey: "FIREWORKS_API_KEY",
		models: [
			{ id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "accounts/fireworks/models/llama-v3p1-405b-instruct", name: "Llama 3.1 405B", contextWindow: 131072, supportsTools: true },
			{ id: "accounts/fireworks/models/qwen2p5-72b-instruct", name: "Qwen 2.5 72B", contextWindow: 32768, supportsTools: true },
			{ id: "accounts/fireworks/models/deepseek-v3", name: "DeepSeek V3", contextWindow: 65536, supportsTools: true },
			{ id: "accounts/fireworks/models/deepseek-r1", name: "DeepSeek R1", contextWindow: 65536 },
		],
	},

	// ── Cohere ────────────────────────────────────────────────────────────
	{
		id: "cohere",
		name: "Cohere",
		type: "openai-compat",
		baseURL: "https://api.cohere.ai/compatibility/v1",
		envKey: "COHERE_API_KEY",
		models: [
			{ id: "command-r-plus", name: "Command R+", contextWindow: 128000, supportsTools: true },
			{ id: "command-r", name: "Command R", contextWindow: 128000, supportsTools: true },
			{ id: "command-r7b-12-2024", name: "Command R7B", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── xAI (Grok) ────────────────────────────────────────────────────────
	{
		id: "xai",
		name: "xAI",
		type: "openai-compat",
		baseURL: "https://api.x.ai/v1",
		envKey: "XAI_API_KEY",
		models: [
			{ id: "grok-3", name: "Grok 3", contextWindow: 131072, supportsTools: true },
			{ id: "grok-3-mini", name: "Grok 3 Mini", contextWindow: 131072, supportsTools: true },
			{ id: "grok-2-1212", name: "Grok 2", contextWindow: 131072, supportsVision: true, supportsTools: true },
		],
	},

	// ── Cerebras ──────────────────────────────────────────────────────────
	{
		id: "cerebras",
		name: "Cerebras",
		type: "openai-compat",
		baseURL: "https://api.cerebras.ai/v1",
		envKey: "CEREBRAS_API_KEY",
		models: [
			{ id: "llama3.3-70b", name: "Llama 3.3 70B", contextWindow: 128000, supportsTools: true },
			{ id: "llama3.1-8b", name: "Llama 3.1 8B", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── SambaNova ─────────────────────────────────────────────────────────
	{
		id: "sambanova",
		name: "SambaNova",
		type: "openai-compat",
		baseURL: "https://fast-api.snova.ai/v1",
		envKey: "SAMBANOVA_API_KEY",
		models: [
			{ id: "Meta-Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B", contextWindow: 16384, supportsTools: true },
			{ id: "DeepSeek-R1", name: "DeepSeek R1", contextWindow: 32768 },
		],
	},

	// ── Hyperbolic ────────────────────────────────────────────────────────
	{
		id: "hyperbolic",
		name: "Hyperbolic",
		type: "openai-compat",
		baseURL: "https://api.hyperbolic.xyz/v1",
		envKey: "HYPERBOLIC_API_KEY",
		models: [
			{ id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", contextWindow: 65536, supportsTools: true },
			{ id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 65536 },
			{ id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", contextWindow: 32768, supportsTools: true },
		],
	},

	// ── OpenRouter ────────────────────────────────────────────────────────
	{
		id: "openrouter",
		name: "OpenRouter",
		type: "openai-compat",
		baseURL: "https://openrouter.ai/api/v1",
		envKey: "OPENROUTER_API_KEY",
		models: [
			{ id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "anthropic/claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "openai/gpt-4o", name: "GPT-4o", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "deepseek/deepseek-chat", name: "DeepSeek V3", contextWindow: 65536, supportsTools: true },
			{ id: "deepseek/deepseek-r1", name: "DeepSeek R1", contextWindow: 65536 },
			{ id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "mistralai/mistral-large", name: "Mistral Large", contextWindow: 128000, supportsTools: true },
			{ id: "x-ai/grok-3", name: "Grok 3", contextWindow: 131072, supportsTools: true },
			{ id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B", contextWindow: 32768, supportsTools: true },
		],
	},

	// ── Azure OpenAI ──────────────────────────────────────────────────────
	{
		id: "azure",
		name: "Azure OpenAI",
		type: "openai-compat",
		baseURL: "", // set dynamically from AZURE_OPENAI_ENDPOINT
		envKey: "AZURE_OPENAI_API_KEY",
		models: [
			{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "gpt-4-turbo", name: "GPT-4 Turbo", contextWindow: 128000, supportsVision: true, supportsTools: true },
			{ id: "o1", name: "o1", contextWindow: 200000, supportsTools: true },
			{ id: "o3-mini", name: "o3 Mini", contextWindow: 200000, supportsTools: true },
		],
	},

	// ── Ollama (local) ────────────────────────────────────────────────────
	{
		id: "ollama",
		name: "Ollama",
		type: "openai-compat",
		baseURL: "http://localhost:11434/v1",
		envKey: "OLLAMA_API_KEY",
		models: [
			{ id: "llama3.3", name: "Llama 3.3", contextWindow: 131072, supportsTools: true },
			{ id: "llama3.2", name: "Llama 3.2", contextWindow: 131072, supportsTools: true },
			{ id: "llama3.1", name: "Llama 3.1", contextWindow: 131072, supportsTools: true },
			{ id: "qwen2.5-coder:32b", name: "Qwen 2.5 Coder 32B", contextWindow: 32768, supportsTools: true },
			{ id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", contextWindow: 32768, supportsTools: true },
			{ id: "deepseek-coder-v2", name: "DeepSeek Coder V2", contextWindow: 128000, supportsTools: true },
			{ id: "codellama", name: "Code Llama", contextWindow: 16384, supportsTools: true },
			{ id: "phi4", name: "Phi-4", contextWindow: 16384, supportsTools: true },
			{ id: "mistral", name: "Mistral 7B", contextWindow: 32768, supportsTools: true },
			{ id: "gemma3", name: "Gemma 3", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── LM Studio (local) ─────────────────────────────────────────────────
	{
		id: "lmstudio",
		name: "LM Studio",
		type: "openai-compat",
		baseURL: "http://localhost:1234/v1",
		envKey: "LMSTUDIO_API_KEY",
		models: [
			{ id: "local-model", name: "Local Model", contextWindow: 32768, supportsTools: true },
		],
	},

	// ── Qwen (Alibaba Cloud) ──────────────────────────────────────────────
	{
		id: "qwen",
		name: "Alibaba Cloud (Qwen)",
		type: "openai-compat",
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		envKey: "DASHSCOPE_API_KEY",
		models: [
			{ id: "qwen-max", name: "Qwen Max", contextWindow: 32768, supportsTools: true },
			{ id: "qwen-plus", name: "Qwen Plus", contextWindow: 131072, supportsTools: true },
			{ id: "qwen-turbo", name: "Qwen Turbo", contextWindow: 1000000, supportsTools: true },
			{ id: "qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", contextWindow: 131072, supportsTools: true },
		],
	},

	// ── Moonshot ──────────────────────────────────────────────────────────
	{
		id: "moonshot",
		name: "Moonshot",
		type: "openai-compat",
		baseURL: "https://api.moonshot.cn/v1",
		envKey: "MOONSHOT_API_KEY",
		models: [
			{ id: "moonshot-v1-128k", name: "Moonshot 128K", contextWindow: 128000, supportsTools: true },
			{ id: "moonshot-v1-32k", name: "Moonshot 32K", contextWindow: 32000, supportsTools: true },
			{ id: "moonshot-v1-8k", name: "Moonshot 8K", contextWindow: 8000, supportsTools: true },
		],
	},

	// ── Zhipu (GLM) ───────────────────────────────────────────────────────
	{
		id: "zhipu",
		name: "Zhipu AI",
		type: "openai-compat",
		baseURL: "https://open.bigmodel.cn/api/paas/v4",
		envKey: "ZHIPU_API_KEY",
		models: [
			{ id: "glm-4-plus", name: "GLM-4 Plus", contextWindow: 128000, supportsTools: true },
			{ id: "glm-4-air", name: "GLM-4 Air", contextWindow: 128000, supportsTools: true },
			{ id: "glm-4-flash", name: "GLM-4 Flash", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── Baidu (ERNIE) ─────────────────────────────────────────────────────
	{
		id: "baidu",
		name: "Baidu (ERNIE)",
		type: "openai-compat",
		baseURL: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat",
		envKey: "BAIDU_API_KEY",
		models: [
			{ id: "ernie-4.0-8k", name: "ERNIE 4.0 8K", contextWindow: 8192, supportsTools: true },
			{ id: "ernie-3.5-8k", name: "ERNIE 3.5 8K", contextWindow: 8192, supportsTools: true },
		],
	},

	// ── Voyage (embeddings + rerank) ──────────────────────────────────────
	{
		id: "voyage",
		name: "Voyage AI",
		type: "openai-compat",
		baseURL: "https://api.voyageai.com/v1",
		envKey: "VOYAGE_API_KEY",
		models: [
			{ id: "voyage-3", name: "Voyage 3", contextWindow: 32000 },
			{ id: "voyage-3-lite", name: "Voyage 3 Lite", contextWindow: 32000 },
		],
	},

	// ── Replicate ─────────────────────────────────────────────────────────
	{
		id: "replicate",
		name: "Replicate",
		type: "openai-compat",
		baseURL: "https://openai-compat.replicate.com/v1",
		envKey: "REPLICATE_API_KEY",
		models: [
			{ id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", contextWindow: 65536 },
		],
	},

	// ── Vertex AI ─────────────────────────────────────────────────────────
	{
		id: "vertex",
		name: "Google Vertex AI",
		type: "openai-compat",
		baseURL: "", // set dynamically from VERTEX_PROJECT + VERTEX_LOCATION
		envKey: "VERTEX_API_KEY",
		models: [
			{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1000000, supportsVision: true, supportsTools: true },
			{ id: "claude-sonnet-4-5@20251112", name: "Claude Sonnet 4.5 (Vertex)", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "claude-opus-4-5@20251112", name: "Claude Opus 4.5 (Vertex)", contextWindow: 200000, supportsVision: true, supportsTools: true },
		],
	},

	// ── Bedrock ───────────────────────────────────────────────────────────
	{
		id: "bedrock",
		name: "AWS Bedrock",
		type: "openai-compat",
		baseURL: "", // set dynamically from AWS_REGION
		envKey: "AWS_ACCESS_KEY_ID",
		models: [
			{ id: "anthropic.claude-3-5-sonnet-20241022-v2:0", name: "Claude 3.5 Sonnet (Bedrock)", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "anthropic.claude-3-opus-20240229-v1:0", name: "Claude 3 Opus (Bedrock)", contextWindow: 200000, supportsVision: true, supportsTools: true },
			{ id: "amazon.nova-pro-v1:0", name: "Amazon Nova Pro", contextWindow: 300000, supportsVision: true, supportsTools: true },
			{ id: "amazon.nova-lite-v1:0", name: "Amazon Nova Lite", contextWindow: 300000, supportsVision: true, supportsTools: true },
			{ id: "meta.llama3-3-70b-instruct-v1:0", name: "Llama 3.3 70B (Bedrock)", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── Nvidia NIM ────────────────────────────────────────────────────────
	{
		id: "nvidia",
		name: "NVIDIA NIM",
		type: "openai-compat",
		baseURL: "https://integrate.api.nvidia.com/v1",
		envKey: "NVIDIA_API_KEY",
		models: [
			{ id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", contextWindow: 32768 },
			{ id: "qwen/qwen2.5-72b-instruct", name: "Qwen 2.5 72B", contextWindow: 32768, supportsTools: true },
			{ id: "mistralai/mistral-large-2-instruct", name: "Mistral Large 2", contextWindow: 128000, supportsTools: true },
		],
	},

	// ── Hugging Face Inference ────────────────────────────────────────────
	{
		id: "huggingface",
		name: "Hugging Face",
		type: "openai-compat",
		baseURL: "https://api-inference.huggingface.co/v1",
		envKey: "HUGGINGFACE_API_KEY",
		models: [
			{ id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: 131072, supportsTools: true },
			{ id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", contextWindow: 32768, supportsTools: true },
			{ id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", contextWindow: 32768 },
			{ id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B", contextWindow: 32768, supportsTools: true },
		],
	},

	// ── Anyscale ──────────────────────────────────────────────────────────
	{
		id: "anyscale",
		name: "Anyscale",
		type: "openai-compat",
		baseURL: "https://api.endpoints.anyscale.com/v1",
		envKey: "ANYSCALE_API_KEY",
		models: [
			{ id: "meta-llama/Llama-3-70b-chat-hf", name: "Llama 3 70B", contextWindow: 8192, supportsTools: true },
			{ id: "mistralai/Mistral-7B-Instruct-v0.1", name: "Mistral 7B", contextWindow: 32768, supportsTools: true },
		],
	},

	// ── Cloudflare Workers AI ─────────────────────────────────────────────
	{
		id: "cloudflare",
		name: "Cloudflare Workers AI",
		type: "openai-compat",
		baseURL: "", // set dynamically: https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1
		envKey: "CLOUDFLARE_API_KEY",
		models: [
			{ id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B", contextWindow: 128000, supportsTools: true },
			{ id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill", contextWindow: 32768 },
			{ id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", contextWindow: 32768, supportsTools: true },
			{ id: "@cf/mistral/mistral-7b-instruct-v0.2-lora", name: "Mistral 7B", contextWindow: 32768, supportsTools: true },
		],
	},

	// ── OpenCode Zen (free tier, keyless) ──────────────────────────────────
	// The desktop app's existing sessions use provider id "opencode" with these
	// "-free" models. The gateway serves them over an OpenAI-compatible API at
	// this base URL with NO Authorization header (a bogus key returns 401).
	{
		id: "opencode",
		name: "OpenCode Zen",
		type: "openai-compat",
		baseURL: "https://opencode.ai/zen/v1",
		envKey: "OPENCODE_ZEN_API_KEY",
		keyless: true,
		models: [
			{ id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning (free)", contextWindow: 128000, supportsTools: true },
			{ id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (free)", contextWindow: 128000, supportsTools: true },
			{ id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash (free)", contextWindow: 128000, supportsTools: true },
			{ id: "mimo-v2.5-free", name: "MiMo v2.5 (free)", contextWindow: 128000, supportsTools: true },
			{ id: "hy3-free", name: "HY3 (free)", contextWindow: 128000, supportsTools: true },
			{ id: "laguna-s-2.1-free", name: "Laguna S 2.1 (free)", contextWindow: 128000, supportsTools: true },
		],
	},
]

const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.id, p]))
// Accept the legacy "opencode-zen" id as an alias for "opencode".
PROVIDER_MAP.set("opencode-zen", PROVIDER_MAP.get("opencode")!)

export function getProvider(id: string): ProviderDef | undefined {
	return PROVIDER_MAP.get(id)
}

export function getAllProviders(): ProviderDef[] {
	return PROVIDERS
}

export function getModel(providerId: string, modelId: string): ModelDef | undefined {
	return getProvider(providerId)?.models.find((m) => m.id === modelId)
}
