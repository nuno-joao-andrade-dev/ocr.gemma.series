#!/bin/bash

# ==============================================================================
# GDG Lisbon - GenAI Community: Massive OCR at the Edge Local Launcher
# ==============================================================================
# This script configures and launches the self-contained frontend demo and
# RAG Search server locally for your presentation.
# ==============================================================================

# Styling helpers for premium terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

clear
echo -e "${BLUE}${BOLD}==========================================================================${NC}"
echo -e "${GREEN}${BOLD} 🚀 GDG LISBON - GENAI COMMUNITY: MASSIVE OCR AT THE EDGE LOCAL LAUNCHER ${NC}"
echo -e "${CYAN}${BOLD} Speaker: Nuno Andrade (Cloud Platform Expert) ${NC}"
echo -e "${BLUE}${BOLD}==========================================================================${NC}"

# 1. Environment and Prerequisite Checks
echo -e "${CYAN}${BOLD}[1/4] Checking System Prerequisites...${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${RED}❌ Error: Node.js is not installed. Please install Node.js (v18+) to run the demo.${NC}"
  exit 1
else
  NODE_VER=$(node -v)
  echo -e "${GREEN}✓ Node.js is installed (${NODE_VER})${NC}"
fi

if ! command -v npm &> /dev/null; then
  echo -e "${RED}❌ Error: npm is not installed.${NC}"
  exit 1
else
  NPM_VER=$(npm -v)
  echo -e "${GREEN}✓ npm is installed (v${NPM_VER})${NC}"
fi

# 2. Check and Install Dependencies
echo -e ""
echo -e "${CYAN}${BOLD}[2/4] Verifying Frontend Dependencies...${NC}"
if [ ! -d "frontend/node_modules" ]; then
  echo -e "${YELLOW}⚠️ node_modules not found in frontend/. Installing dependencies...${NC}"
  cd frontend && npm install && cd ..
  echo -e "${GREEN}✓ Dependencies successfully installed!${NC}"
else
  echo -e "${GREEN}✓ node_modules already present in frontend/. Ready to boot.${NC}"
fi

# 3. Check Local AI Environment (Ollama / Gemma 4)
echo -e ""
echo -e "${CYAN}${BOLD}[3/4] Checking Local AI Environment (Ollama)...${NC}"
OLLAMA_RUNNING=false

# Attempt to query local Ollama API
if curl -s -f http://localhost:11434/api/tags &>/dev/null; then
  OLLAMA_RUNNING=true
  echo -e "${GREEN}✓ Ollama is running locally on port 11434!${NC}"
  
  # Check if gemma4 model is available
  GEMMA_PULLED=$(curl -s http://localhost:11434/api/tags | grep -q "gemma4" && echo "true" || echo "false")
  if [ "$GEMMA_PULLED" = "true" ]; then
    echo -e "${GREEN}✓ Model 'gemma4:latest' is available for OCR & RAG workloads.${NC}"
  else
    echo -e "${YELLOW}⚠️ Model 'gemma4:latest' is not found in your local Ollama registry.${NC}"
    echo -e "${YELLOW}   If you want to use local Gemma 4, run: ${BOLD}ollama pull gemma4${NC}"
    echo -e "${CYAN}   No worries! The app will automatically fall back to ADK ocrAgent / Mock modes.${NC}"
  fi
else
  echo -e "${YELLOW}⚠️ Ollama is not running on http://localhost:11434.${NC}"
  echo -e "${CYAN}   The app will automatically run in high-fidelity ADK fallback & Mock modes.${NC}"
  echo -e "${CYAN}   This fallback is 100% presentation-safe and requires zero cloud credentials.${NC}"
fi

# 4. Set Environment Variables & Launch
echo -e ""
echo -e "${CYAN}${BOLD}[4/4] Starting Local Frontend & RAG Server...${NC}"

# Export default configuration variables for the demo
export INPUT_BUCKET="gdg-bulk-ocr-input"
export OUTPUT_BUCKET="gdg-bulk-ocr-output"
export MODEL_NAME="gemma4:latest"
export PORT=3000

echo -e "${MAGENTA}${BOLD}--------------------------------------------------------------------------${NC}"
echo -e "${GREEN}${BOLD}✓ Local Server starting up at:${NC} ${BOLD}http://localhost:3000${NC}"
echo -e "${CYAN}Press ${BOLD}Ctrl+C${NC} ${CYAN}to terminate the server when done.${NC}"
echo -e "${MAGENTA}${BOLD}--------------------------------------------------------------------------${NC}"
echo -e ""

# Execute Express app inside the frontend folder
cd frontend
node server.js
