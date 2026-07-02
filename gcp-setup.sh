#!/bin/bash

# ==============================================================================
# GDG Lisbon - GenAI Community: Intelligent Document Digitalization & OCR Pipeline Setup
# ==============================================================================
# This script provisions all the Google Cloud Platform infrastructure required
# for the event-driven document OCR digitalization pipeline.
#
# Pipeline Architecture:
# GCS Input Bucket (Upload) ➔ GCS Event Notification ➔ Pub/Sub Topic ➔
# Pub/Sub Push Subscription ➔ Cloud Run Service (Gemma 4 OCR) ➔ GCS Output Bucket
# ==============================================================================

# Exit immediately if a command exits with a non-zero status
set -e

# --- Configuration Variables ---
# Attempt to auto-detect current project, fallback to placeholder
PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: No active gcloud project found."
  echo "Please set your project first: gcloud config set project [YOUR_PROJECT_ID]"
  exit 1
fi

REGION="us-central1"
INPUT_BUCKET="${PROJECT_ID}-bulk-ocr-input"
OUTPUT_BUCKET="${PROJECT_ID}-bulk-ocr-output"
TOPIC_NAME="bulk-ocr-uploads"
SUBSCRIPTION_NAME="bulk-ocr-cloudrun-sub"
SERVICE_NAME="bulk-ocr-service"
MODEL_NAME="gemma4:e2b" # The Gemma-4 model name for local Ollama OCR

echo "=========================================================================="
echo "🚀 Initializing GCP Infrastructure Provisioning"
echo "=========================================================================="
echo "Project ID:   $PROJECT_ID"
echo "Region:       $REGION"
echo "Input Bucket:  gs://$INPUT_BUCKET"
echo "Output Bucket: gs://$OUTPUT_BUCKET"
echo "Pub/Sub Topic:$TOPIC_NAME"
echo "Cloud Run:    $SERVICE_NAME (Model: $MODEL_NAME)"
echo "=========================================================================="

# 1. Enable Required Google Cloud APIs
echo "🌐 Step 1: Enabling Required Google Cloud APIs..."
gcloud services enable \
  storage.googleapis.com \
  pubsub.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  cloudbuild.googleapis.com

# 2. Create Cloud Storage Buckets
echo "🪣 Step 2: Creating Cloud Storage Buckets..."
# Check and create input bucket
if gsutil ls -b "gs://$INPUT_BUCKET" >/dev/null 2>&1; then
  echo "ℹ️ Input bucket gs://$INPUT_BUCKET already exists."
else
  echo "Creating input bucket gs://$INPUT_BUCKET..."
  gsutil mb -l "$REGION" "gs://$INPUT_BUCKET"
fi

# Check and create output bucket
if gsutil ls -b "gs://$OUTPUT_BUCKET" >/dev/null 2>&1; then
  echo "ℹ️ Output bucket gs://$OUTPUT_BUCKET already exists."
else
  echo "Creating output bucket gs://$OUTPUT_BUCKET..."
  gsutil mb -l "$REGION" "gs://$OUTPUT_BUCKET"
fi

# 3. Create Cloud Pub/Sub Topic
echo "📣 Step 3: Creating Pub/Sub Topic..."
if gcloud pubsub topics describe "$TOPIC_NAME" >/dev/null 2>&1; then
  echo "ℹ️ Pub/Sub topic '$TOPIC_NAME' already exists."
else
  echo "Creating topic '$TOPIC_NAME'..."
  gcloud pubsub topics create "$TOPIC_NAME"
fi

# 4. Configure GCS Pub/Sub Publisher Permissions
# Cloud Storage needs permission to publish events to our Pub/Sub topic.
echo "🔐 Step 4: Configuring IAM Permissions for Cloud Storage..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
GCS_SERVICE_ACCOUNT="service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com"

echo "Granting Pub/Sub Publisher role to Storage Service Account: $GCS_SERVICE_ACCOUNT"
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member="serviceAccount:$GCS_SERVICE_ACCOUNT" \
  --role="roles/pubsub.publisher"

# 5. Create GCS Object Finalize Event Notification
echo "🔔 Step 5: Creating Cloud Storage Event Notifications..."
# Check if notifications already exist, if not, create
NOTIFICATIONS=$(gcloud storage buckets notifications list "gs://$INPUT_BUCKET" --format="value(name)" 2>/dev/null || echo "")
if [ -n "$NOTIFICATIONS" ]; then
  echo "ℹ️ Event notifications are already configured for gs://$INPUT_BUCKET"
else
  echo "Creating event notification for OBJECT_FINALIZE (file uploads)..."
  gcloud storage buckets notifications create "gs://$INPUT_BUCKET" \
    --topic="$TOPIC_NAME" \
    --event-types="OBJECT_FINALIZE"
fi

# 6. Deploy Cloud Run Service
echo "🐳 Step 6: Deploying OCR Cloud Run Service from Source..."
# We deploy from the local cloud-run directory. 
# It builds the container on Cloud Build and deploys to Cloud Run in one command!
cd cloud-run
gcloud run deploy "$SERVICE_NAME" \
  --source=. \
  --region="$REGION" \
  --allow-unauthenticated \
  --set-env-vars="OUTPUT_BUCKET=$OUTPUT_BUCKET,MODEL_NAME=$MODEL_NAME" \
  --min-instances=1 \
  --max-instances=10 \
  --cpu=2 \
  --memory=2Gi
cd ..

# Retrieve deployed Cloud Run service URL
echo "🔗 Step 7: Retrieving Cloud Run Service Endpoint URL..."
CLOUD_RUN_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)')
echo "Cloud Run Endpoint URL: $CLOUD_RUN_URL"

# 7. Create Pub/Sub Push Subscription linked to Cloud Run
echo "📬 Step 8: Creating Pub/Sub Push Subscription to Cloud Run..."
if gcloud pubsub subscriptions describe "$SUBSCRIPTION_NAME" >/dev/null 2>&1; then
  echo "Updating existing Pub/Sub Push Subscription..."
  gcloud pubsub subscriptions update "$SUBSCRIPTION_NAME" \
    --push-endpoint="$CLOUD_RUN_URL"
else
  echo "Creating new Pub/Sub Push Subscription pointing to $CLOUD_RUN_URL..."
  # To make this fully secure in production, you can create a dedicated service account 
  # and use --push-auth-service-account to authenticate push requests with Cloud Run IAM.
  gcloud pubsub subscriptions create "$SUBSCRIPTION_NAME" \
    --topic="$TOPIC_NAME" \
    --push-endpoint="$CLOUD_RUN_URL" \
    --ack-deadline=600 # Gemma-4 OCR processing can take time, give it 10 minutes deadline
fi

echo "=========================================================================="
echo "🎉 Congratulations! GDG Lisbon - GenAI Community OCR Pipeline Infrastructure is Live!"
echo "=========================================================================="
echo "👉 Upload document images to your input bucket to trigger OCR:"
echo "   gsutil cp page1.jpg gs://$INPUT_BUCKET/gdg_event_guide/page1.jpg"
echo ""
echo "👉 Check OCR output text and JSON metadata in your output bucket:"
echo "   gsutil ls gs://$OUTPUT_BUCKET/gdg_event_guide/"
echo ""
echo "👉 Start your Local RAG and Web Search server:"
echo "   cd frontend"
echo "   export INPUT_BUCKET=$INPUT_BUCKET"
echo "   export OUTPUT_BUCKET=$OUTPUT_BUCKET"
echo "   npm start"
echo "=========================================================================="
