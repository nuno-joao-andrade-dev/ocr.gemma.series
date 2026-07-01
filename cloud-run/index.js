import express from 'express';
import { Storage } from '@google-cloud/storage';
import { InMemoryRunner } from '@google/adk';
import { ocrAgent, getOllamaModel } from './agent.js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

const storage = new Storage();
const port = process.env.PORT || 8080;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Main endpoint to handle Pub/Sub push events
app.post('/', async (req, res) => {
  if (!req.body || !req.body.message) {
    console.error('Invalid Pub/Sub message received');
    return res.status(400).send('Bad Request: Invalid message format');
  }

  const message = req.body.message;
  let dataStr;
  try {
    dataStr = Buffer.from(message.data, 'base64').toString().trim();
  } catch (err) {
    console.error('Error decoding base64 Pub/Sub data:', err);
    return res.status(400).send('Bad Request: Base64 decode failed');
  }

  let gcsEvent;
  try {
    gcsEvent = JSON.parse(dataStr);
  } catch (err) {
    console.error('Failed to parse decoded GCS event JSON:', err);
    return res.status(400).send('Bad Request: Invalid JSON in payload');
  }

  const { bucket, name: fileName, contentType } = gcsEvent;

  if (!bucket || !fileName) {
    console.warn('Skipping event: missing bucket or fileName in payload:', gcsEvent);
    return res.status(200).send('Skipped: missing bucket or fileName');
  }

  // Skip directories, non-images, or already processed output files
  if (fileName.endsWith('/') || (contentType && !contentType.startsWith('image/'))) {
    console.log(`Skipping file: ${fileName} with type ${contentType || 'unknown'}`);
    return res.status(200).send('Skipped: not an image file');
  }

  console.log(`[OCR Processing Start] GCS file: gs://${bucket}/${fileName}`);

  try {
    // 1. Download file content from GCS input bucket
    const file = storage.bucket(bucket).file(fileName);
    const [exists] = await file.exists();
    if (!exists) {
      console.error(`File gs://${bucket}/${fileName} does not exist anymore.`);
      return res.status(200).send('Skipped: file not found');
    }

    const [fileContent] = await file.download();
    const base64Image = fileContent.toString('base64');
    const mimeType = contentType || getMimeTypeByExtension(fileName);

    let ocrResponseText = '';

    // 2. OCR Ingestion Pipeline via ADK Agent running Ollama (Gemma-4)
    try {
      const targetModel = getOllamaModel();
      ocrAgent.model = targetModel;

      console.log(`[Cloud Run OCR] Invoking ADK ocrAgent via InMemoryRunner with model: ${targetModel}...`);
      
      const runner = new InMemoryRunner({ agent: ocrAgent });
      const userId = 'cloud-run-consumer';
      const session = await runner.sessionService.createSession(runner.appName, userId);

      const run = runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: {
          role: 'user',
          parts: [
            {
              text: `Please OCR this document image. Retrieve all metadata and extract all visible text blocks with their normalized [ymin, xmin, ymax, xmax] coordinates (0.0 to 1.0).`
            },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: base64Image
              }
            }
          ]
        }
      });

      ocrResponseText = '';
      for await (const event of run) {
        if (event.content && event.content.parts) {
          for (const part of event.content.parts) {
            if (part.text) {
              ocrResponseText += part.text;
            }
          }
        }
      }

      console.log(`[Cloud Run OCR Success] OCR completed successfully via ADK & Ollama.`);
    } catch (ollamaErr) {
      console.error(`[Cloud Run OCR Error] ADK/Ollama execution failed: ${ollamaErr.message}`);
      throw new Error(`Ollama execution failed: ${ollamaErr.message}`);
    }

    // 3. Clean, parse, and sanitize response metadata & coordinates
    let ocrData;
    try {
      ocrData = parseAgentJson(ocrResponseText);
      
      // Sanitize coordinates and prevent zero-height/collapse
      if (ocrData && ocrData.text_blocks) {
        console.log(`[Cloud Run Coordinate Sanitization] Processing coordinates for ${ocrData.text_blocks.length} text blocks.`);
        ocrData.text_blocks = ocrData.text_blocks.map(block => {
          if (block.area) {
            block.area = normalizeAndAdjustCoordinates(block.area);
          }
          return block;
        });
      }
    } catch (parseErr) {
      console.error('Failed to parse agent output as JSON. Storing raw output and skipping metadata. Raw text:', ocrResponseText);
      ocrData = {
        metadata: {
          title: path.basename(fileName),
          creation_date: 'Unknown',
          author: 'Unknown',
          parsing_error: 'Model did not output pure JSON: ' + parseErr.message
        },
        text_blocks: [],
        full_text: ocrResponseText
      };
    }

    // 4. Determine output bucket and write GCS files
    const outputBucketName = process.env.OUTPUT_BUCKET || bucket.replace('-input', '-output');
    const baseName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
    
    const outputTextPath = `${baseName}.txt`;
    const outputJsonPath = `${baseName}_metadata.json`;

    console.log(`Saving outputs to output bucket: gs://${outputBucketName}`);

    // Save consolidated text file
    const textFile = storage.bucket(outputBucketName).file(outputTextPath);
    await textFile.save(ocrData.full_text || '', {
      contentType: 'text/plain',
      resumable: false,
    });
    console.log(`Saved text output: ${outputTextPath}`);

    // Save structured metadata JSON file
    const jsonFile = storage.bucket(outputBucketName).file(outputJsonPath);
    await jsonFile.save(JSON.stringify(ocrData, null, 2), {
      contentType: 'application/json',
      resumable: false,
    });
    console.log(`Saved metadata output: ${outputJsonPath}`);

    console.log(`[OCR Processing End] Successfully processed gs://${bucket}/${fileName}`);
    res.status(200).send(`Success: Processed ${fileName}`);

  } catch (error) {
    console.error(`[OCR Processing Error] Failed to process gs://${bucket}/${fileName}:`, error);
    // Return 200 OK so Pub/Sub does not endlessly retry failed files, but we log the error clearly
    res.status(500).send(`Error processing file: ${error.message}`);
  }
});

// Helper to deduce mime type from file name if contentType is missing
function getMimeTypeByExtension(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'image/jpeg'; // Default fallback
  }
}

// Helper to strip markdown and extract clean JSON
function parseAgentJson(text) {
  let cleanText = text.trim();
  
  // Find first { and last } to extract JSON block if there's conversational preamble/postamble
  const startIdx = cleanText.indexOf('{');
  const endIdx = cleanText.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleanText = cleanText.substring(startIdx, endIdx + 1);
  } else {
    // Strip markdown code block wrappers if present (as fallback)
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\n?/i, '').replace(/```$/, '').trim();
    }
  }
  
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    console.warn(`[JSON Parse Warning] Direct parsing failed: ${err.message}.`);
    throw err;
  }
}



// Helper to normalize [0, 1] coordinates and clamp to [0, 1000] strictly
function normalizeAndAdjustCoordinates(area) {
  if (!area) return area;

  // Clone area to avoid side effects
  let adjusted = { ...area };

  // Detect if coordinates are in [0, 1] instead of [0, 1000]
  // If all values are <= 1.0, they are likely in [0, 1]
  const isZeroToOne = (
    (adjusted.ymin <= 1.0) &&
    (adjusted.xmin <= 1.0) &&
    (adjusted.ymax <= 1.0) &&
    (adjusted.xmax <= 1.0) &&
    (adjusted.ymin > 0 || adjusted.xmin > 0 || adjusted.ymax > 0 || adjusted.xmax > 0)
  );

  if (isZeroToOne) {
    adjusted.ymin *= 1000;
    adjusted.xmin *= 1000;
    adjusted.ymax *= 1000;
    adjusted.xmax *= 1000;
  }

  // Ensure logical ordering (ymin <= ymax, xmin <= xmax)
  if (adjusted.ymin > adjusted.ymax) {
    const temp = adjusted.ymin;
    adjusted.ymin = adjusted.ymax;
    adjusted.ymax = temp;
  }
  if (adjusted.xmin > adjusted.xmax) {
    const temp = adjusted.xmin;
    adjusted.xmin = adjusted.xmax;
    adjusted.xmax = temp;
  }

  // Prevent zero-width/height collapse: if height or width is too small, expand it.
  if (adjusted.ymax - adjusted.ymin < 10) {
    const midY = (adjusted.ymin + adjusted.ymax) / 2;
    adjusted.ymin = Math.max(0, midY - 7.5);
    adjusted.ymax = Math.min(1000, midY + 7.5);
  }
  if (adjusted.xmax - adjusted.xmin < 10) {
    const midX = (adjusted.xmin + adjusted.xmax) / 2;
    adjusted.xmin = Math.max(0, midX - 7.5);
    adjusted.xmax = Math.min(1000, midX + 7.5);
  }

  // Final sanity check to round and clamp strictly to [0, 1000]
  adjusted.ymin = Math.round(Math.max(0, Math.min(1000, adjusted.ymin)));
  adjusted.xmin = Math.round(Math.max(0, Math.min(1000, adjusted.xmin)));
  adjusted.ymax = Math.round(Math.max(0, Math.min(1000, adjusted.ymax)));
  adjusted.xmax = Math.round(Math.max(0, Math.min(1000, adjusted.xmax)));

  return adjusted;
}

app.listen(port, () => {
  console.log(`OCR Cloud Run Service listening on port ${port}`);
});
