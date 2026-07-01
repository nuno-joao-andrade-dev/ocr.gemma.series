# GDG Lisbon - GenAI Community: Massive OCR at the Edge

Welcome to the **Massive OCR at the Edge & RAG Search** developer's manual. This repository contains a production-ready, privacy-first, event-driven OCR and Document Digitalization pipeline built with **Google Agent Development Kit (ADK)**, **Gemma 4 / Gemini**, and **Google Cloud Platform (GCP)**.

---

## Architecture Overview

![Gemma OCR and RAG Architecture](https://raw.githubusercontent.com/nuno-joao-andrade-dev/resources_gallery/refs/heads/main/ocr.gemma.series.png)

*View and edit the [interactive architecture diagram here](https://drawit.nja.dev/?gallery=ocr.gemma.series).*

The system is split into two primary components:
1. **`cloud-run`**: An event-driven Cloud Run service running on GCP. It triggers automatically when document images are uploaded to GCS, processes them via a specialized Google ADK OCR agent running Gemma 4 (or Gemini), parses structural layout coordinate maps, and saves structured JSON metadata into the GCS output bucket.
2. **`frontend`**: A premium React single-page application and Express RAG Search server. It fetches digitized documents from the output bucket, showcases interactive visual layout coordinates on a document canvas, and leverages a multi-tier local/cloud RAG agent to semantically search and highlight coordinates on visual overlays.

---

## Project Structure

```
.
├── .gitignore                  # Git exclusion rules for dependencies and secrets
├── README.md                   # Project documentation manual (this file)
├── gcp-setup.sh                # Automation script to provision full GCP pipeline
├── launch-local.sh             # Interactive local launcher script for offline demo
├── package.json                # Project root dependency and run scripts
│
├── cloud-run/                  # Event-driven OCR Microservice (GCP Cloud Run)
│   ├── Dockerfile              # Lightweight alpine container build spec
│   ├── agent.js                # ADK LlmAgent & custom Ollama LLM provider definition
│   ├── index.js                # Express service processing Pub/Sub events & writing outputs
│   └── package.json            # Service dependency manifest
│
└── frontend/                   # Frontend Web Application & RAG Server
    ├── ragAgent.js             # ADK RAG Search agent definition & instructions
    ├── server.js               # Express server driving document loading & RAG endpoints
    ├── package.json            # Frontend dependency manifest
    └── public/                 # Static assets served to the client browser
        ├── app.js              # Interactive React single-page dashboard application
        ├── index.html          # Dashboard entry point
        └── style.css           # Premium styling, animations, and typography
```

---

## Prerequisites

Before getting started, make sure you have the following installed:
* [Node.js](https://nodejs.org/) (v18 or higher)
* [npm](https://www.npmjs.com/) (installed automatically with Node)
* [Google Cloud SDK (gcloud CLI)](https://cloud.google.com/sdk/docs/install) (required for GCP deployment)
* [Ollama](https://ollama.com/) *(optional)*: For local/edge execution. Make sure to download and pull the Gemma-4 model:
  ```bash
  ollama pull gemma4
  ```

---

## Quickstart: Launching with NPM Scripts

Convenient NPM scripts have been added to the root `package.json` to make running, developing, and debugging the project simple:

| Script Name | Command | Description |
| :--- | :--- | :--- |
| `npm start` | `npm --prefix frontend start` | Launches the RAG Search Frontend and Web Server (port 3000) |
| `npm run cloud-run` | `npm --prefix cloud-run start` | Runs the local OCR Cloud Run backend emulation server (port 8080) |
| `npm run adk-web` | `npx adk web` | Launches the **ADK Devtools Web Console** for debugging agent sessions |
| `npm run launch-local` | `./launch-local.sh` | Launches the self-contained offline developer simulation guide and launcher |

### 1. Launching the Frontend locally
To quickly launch the interactive dashboard and RAG server:
```bash
npm start
```
Or use the interactive shell script launcher:
```bash
npm run launch-local
```

### 2. Launching the Local Cloud-Run Emulator
To run the event-driven Cloud Run background processing container emulation:
```bash
npm run cloud-run
```

### 3. Launching ADK Devtools Web Interface
To debug, visualize, and interact with the Agent Development Kit sessions and runs:
```bash
npm run adk-web
```

---

## Setting Up & Deploying GCP Infrastructure (Cloud Run)

> [!IMPORTANT]
> **Note on Testing**: Please note that the Cloud Run deployment and live GCP integration scripts have not been fully tested in a live production GCP environment. The provided scripts represent the target infrastructure architecture design.

A robust automation script (`gcp-setup.sh`) is provided to provision the entire cloud backend infrastructure.

To deploy the event-driven OCR pipeline on your active GCP project:
```bash
# 1. Auth and set your active project ID
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 2. Grant executable permissions and run the provisioning script
chmod +x gcp-setup.sh
./gcp-setup.sh
```

### Step-by-Step GCP Provisioning Process:
1. **API Enablement**: Automatically enables all required services: Cloud Storage, Pub/Sub, Cloud Run, Artifact Registry, Vertex AI, and Cloud Build.
2. **Storage Provisioning**: Creates two secure GCS buckets in your specified region:
   * Input Bucket: `gs://[PROJECT_ID]-bulk-ocr-input`
   * Output Bucket: `gs://[PROJECT_ID]-bulk-ocr-output`
3. **Messaging Topic**: Creates a Cloud Pub/Sub topic named `bulk-ocr-uploads`.
4. **IAM Configuration**: Binds publisher permissions so that the Google Cloud Storage service account can securely publish finalization events to the Pub/Sub topic.
5. **GCS Event Notification**: Configures an automatic bucket notification rule on the input bucket. This triggers a `OBJECT_FINALIZE` event whenever a file is uploaded, publishing its metadata to the topic.
6. **Cloud Run Service Deployment**: Containerizes and deploys the `cloud-run` node application to Cloud Run from source. It automatically builds the container using Cloud Build and sets environment variables (`OUTPUT_BUCKET`, `MODEL_NAME`).
7. **Pub/Sub Push Subscription**: Establishes a Pub/Sub Push Subscription (`bulk-ocr-cloudrun-sub`) linking the topic to the deployed Cloud Run service URL, configuring a 10-minute acknowledgement timeout to accommodate large document processing.

---

## Detailed Code Walkthrough

### 1. `cloud-run` Event-Driven OCR Agent
* **`Dockerfile`**: A multi-stage production container utilizing `node:24-alpine` for ultra-small image sizes and faster startup scaling performance on Cloud Run.
* **`agent.js`**:
  * Extends the **Google Agent Development Kit (ADK)** by registering a custom `OllamaLlm` provider extending `BaseLlm` which redirects LLM requests to local Ollama endpoints.
  * Defines `gemma4_ocr_agent` (`LlmAgent`) with system instructions optimized for high-fidelity OCR, document metadata classification, and layout structural coordinate retrieval mapped as normalized coordinates in `[ymin, xmin, ymax, xmax]` float ranges (`0.0` to `1.0`).
* **`index.js`**:
  * Runs an Express web service listening on port `8080` (or `PORT`).
  * Receives Pub/Sub push messages, decodes the raw event base64 payload to discover the GCS bucket and file names, and downloads the uploaded image to memory.
  * Feeds the image bytes to the ADK `ocrAgent`.
  * Parses and cleanses the JSON response from the LLM, sanitizes bounding boxes, and writes both a text-only representation (`.txt`) and a structured metadata block (`_metadata.json`) into the GCS output bucket.

### 2. `frontend` Interactive Dashboard & RAG Agent
* **`server.js`**:
  * Connects to GCS to load all digitized output files or falls back to presentation-safe offline files if credentials are not configured.
  * Hosts the `POST /api/search` endpoint driving the **RAG (Retrieval-Augmented Generation) Search pipeline**.
  * **Multi-Tier Search Execution**:
    1. First tries local **Ollama (Gemma 4)** to query the consolidated document corpus context.
    2. Falls back to **Google ADK** (via a custom `ragAgent` session runner) to answer queries.
    3. Falls back to high-fidelity **Fuzzy Search** (`performFuzzySearch`) for immediate offline demonstration compatibility.
* **`ragAgent.js`**:
  * Defines `rag_search_agent` using ADK with highly targeted instructions. It forces the agent to output a single structured JSON block containing a markdown text synthesis `answer` alongside a `citations` array identifying matching layout coordinate bounding boxes.
* **`public/app.js` (React client)**:
  * Mounts directly to the page using React 18, utilizing on-the-fly Babel transpilation for instant local tweaking without complex webpack configurations.
  * Renders a premium Google-themed responsive dashboard with live pipeline metrics, document selection widgets, and search bars.
  * Draws interactive, semi-transparent bounding box overlays over the physical document canvas when a search query cites exact page coordinates, giving users immediate visual RAG feedback.
* **`public/style.css`**:
  * Designed using modern, premium CSS design tokens. Features background ambient glows, fluid micro-interactions, responsive flex-grid layouts, and state transitions to deliver a spectacular viewer experience.

---

## Presentation & Demo Walkthrough

Once you run `./launch-local.sh`, open **`http://localhost:3000`** in your browser:
1. **Interactive Library**: Select documents inside the **Digitized Library** panel to inspect their OCR full text, classified metadata, and visual coordinates overlay.
2. **Run RAG Queries**: Type natural language questions in the **Semantic Search Query** bar. Example queries to test:
   * *"Show me the speaker name in the GDG presentation guide"*
   * *"What is the total balance on my invoice?"*
   * *"Which technologies are used for edge OCR?"*
3. **Interactive Coordinates Map**: Click on any of the citations generated by the RAG search. The document viewport will automatically focus and draw a highlighted border around the exact text coordinate cited by the RAG agent!
