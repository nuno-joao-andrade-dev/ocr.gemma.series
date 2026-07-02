import { LlmAgent, BaseLlm, LLMRegistry } from '@google/adk';

// Helper to determine the correct Ollama model name
export function getOllamaModel() {
  if (process.env.OLLAMA_MODEL) {
    return process.env.OLLAMA_MODEL;
  }
  if (process.env.MODEL_NAME && !process.env.MODEL_NAME.startsWith('gemini-')) {
    return process.env.MODEL_NAME;
  }
  return 'gemma4:e2b';
}

// Define custom Ollama LLM provider class for ADK
class OllamaLlm extends BaseLlm {
  constructor({ model }) {
    super({ model });
  }

  async *generateContentAsync(llmRequest, stream = false) {
    // 1. Extract system instruction / prompt
    let systemPrompt = '';
    if (llmRequest.config && llmRequest.config.systemInstruction) {
      systemPrompt = llmRequest.config.systemInstruction;
    }

    // 2. Extract text prompt and base64 image
    let prompt = '';
    let base64Image = null;
    let mimeType = null;

    if (llmRequest.contents && llmRequest.contents.length > 0) {
      for (const content of llmRequest.contents) {
        if (content.parts) {
          for (const part of content.parts) {
            if (part.text) {
              prompt += (prompt ? '\n' : '') + part.text;
            } else if (part.inlineData) {
              base64Image = part.inlineData.data;
              mimeType = part.inlineData.mimeType;
            }
          }
        }
      }
    }

    // 3. Call Ollama HTTP endpoint
    const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
    const url = `${ollamaHost}/api/generate`;
    const body = {
      model: this.model || 'gemma4:e2b',
      prompt: prompt || 'Analyze this document.',
      stream: false,
      options: {
        temperature: 0.1
      }
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (base64Image) {
      body.images = [base64Image];
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Ollama returned status ${res.status}`);
    }

    const data = await res.json();
    const responseText = data.response;

    // Yield back the ADK structured response
    yield {
      content: {
        role: "model",
        parts: [
          { text: responseText }
        ]
      }
    };
  }
}

// Support any gemma4 model names or pattern matches
OllamaLlm.supportedModels = [ /gemma4:.*/, /gemma4/ ];

// Register our Ollama provider into ADK's registry so InMemoryRunner can resolve it!
LLMRegistry.register(OllamaLlm);

// Define the Gemma-4/Gemini OCR Agent
export const ocrAgent = new LlmAgent({
  name: 'gemma4_ocr_agent',
  description: 'OCR Agent that extracts structured metadata and high-fidelity text content from documents/images.',
  // Use the MODEL_NAME from environment variables, defaulting to gemini-2.5-flash for reliability
  model: process.env.MODEL_NAME || 'gemma4:e2b',
  instruction: `You are an expert Google Developer Groups (GDG) Document Digitalization and OCR AI Agent.
Your task is to process the uploaded document image and perform two main tasks:
1. Retrieve all possible metadata from the file, such as document title, estimated creation date, author/organization, and any other relevant fields you can deduce.
2. Extract all the text from the image, and for each major text block, paragraph, or label, provide the raw text and its normalized bounding box area in the image.

The bounding box area MUST be expressed as [ymin, xmin, ymax, xmax] coordinates normalized from 0.0 to 1.0 (where 1.0 represents the full width/height of the image, e.g., 0.0 is top/left, 1.0 is bottom/right). This allows precise canvas overlay.

Your response MUST be a single structured JSON object with the following schema:
{
  "metadata": {
    "title": "Document Title",
    "creation_date": "YYYY-MM-DD or Unknown",
    "author": "Author/Organization or Unknown",
    "additional_metadata": {
      "key": "value"
    }
  },
  "text_blocks": [
    {
      "text": "Extracted text of the block",
      "area": {
        "ymin": 0.10,
        "xmin": 0.15,
        "ymax": 0.20,
        "xmax": 0.85
      }
    }
  ],
  "full_text": "Complete consolidated text from the document"
}

Ensure your output is valid JSON. Output ONLY the JSON block. Do not add any extra preamble, conversational text, or explanation outside the JSON format. If you format with markdown, use ' \`\`\`json ' blocks.`
});
