#!/bin/bash
set -euxo pipefail

exec > >(tee /var/log/llm-startup.log) 2>&1
echo "=== LLM Inference Startup Script ==="
echo "Started at: $(date -u)"

# --------------------------------------------------
# Parameters (injected by CDK UserData)
# --------------------------------------------------
MODEL_ID="{{MODEL_ID}}"
QUANTIZATION="{{QUANTIZATION}}"
MAX_MODEL_LEN="{{MAX_MODEL_LEN}}"
TENSOR_PARALLEL_SIZE="{{TENSOR_PARALLEL_SIZE}}"
GPU_MEMORY_UTILIZATION="{{GPU_MEMORY_UTILIZATION}}"
VLLM_IMAGE="{{VLLM_CONTAINER_IMAGE}}"
HF_TOKEN_SECRET_NAME="{{HF_TOKEN_SECRET_NAME}}"

REGION=$(TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60") && \
  curl -sH "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/placement/region)

# --------------------------------------------------
# 1. Install NVIDIA driver, Docker, NVIDIA Container Toolkit
# --------------------------------------------------
echo "Installing prerequisites..."
apt-get update -y
apt-get install -y apt-transport-https ca-certificates curl gnupg unzip jq

# AWS CLI
if ! command -v aws &> /dev/null; then
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
fi

# NVIDIA driver
if ! nvidia-smi > /dev/null 2>&1; then
  echo "Installing NVIDIA driver..."
  apt-get install -y linux-headers-$(uname -r)
  apt-get install -y nvidia-driver-550-server
  echo "NVIDIA driver installed. A reboot may be required."
fi

# Docker
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# NVIDIA Container Toolkit
if ! dpkg -l | grep -q nvidia-container-toolkit; then
  echo "Installing NVIDIA Container Toolkit..."
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -y
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi

# --------------------------------------------------
# 2. Wait for GPU driver to be ready
# --------------------------------------------------
echo "Waiting for NVIDIA driver..."
for i in $(seq 1 30); do
  if nvidia-smi > /dev/null 2>&1; then
    echo "NVIDIA driver ready."
    nvidia-smi
    break
  fi
  echo "Attempt $i/30: GPU not ready yet, waiting 10s..."
  sleep 10
done

if ! nvidia-smi > /dev/null 2>&1; then
  echo "ERROR: NVIDIA driver failed to initialize."
  exit 1
fi

# --------------------------------------------------
# 3. Retrieve HuggingFace token from Secrets Manager
# --------------------------------------------------
echo "Retrieving HuggingFace token from Secrets Manager..."
HF_TOKEN=$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$HF_TOKEN_SECRET_NAME" \
  --query SecretString --output text)

if [ -z "$HF_TOKEN" ]; then
  echo "ERROR: Failed to retrieve HuggingFace token."
  exit 1
fi
echo "HuggingFace token retrieved successfully."

# --------------------------------------------------
# 4. Prepare model cache directory
# --------------------------------------------------
MODEL_CACHE_DIR="/opt/llm/model-cache"
mkdir -p "$MODEL_CACHE_DIR"

# --------------------------------------------------
# 5. Build vLLM serve arguments
# --------------------------------------------------
VLLM_ARGS="--model $MODEL_ID \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size $TENSOR_PARALLEL_SIZE \
  --max-model-len $MAX_MODEL_LEN \
  --gpu-memory-utilization $GPU_MEMORY_UTILIZATION \
  --enable-chunked-prefill"

if [ "$QUANTIZATION" != "none" ]; then
  VLLM_ARGS="$VLLM_ARGS --quantization $QUANTIZATION"
fi

echo "vLLM arguments: $VLLM_ARGS"

# --------------------------------------------------
# 6. Pull and run vLLM container
# --------------------------------------------------
echo "Pulling vLLM container image: $VLLM_IMAGE"
docker pull "$VLLM_IMAGE"

echo "Starting vLLM container..."
docker run -d \
  --name vllm-server \
  --restart always \
  --gpus all \
  --shm-size=16g \
  -p 8000:8000 \
  -e HF_TOKEN="$HF_TOKEN" \
  -e HUGGING_FACE_HUB_TOKEN="$HF_TOKEN" \
  -v "$MODEL_CACHE_DIR:/root/.cache/huggingface" \
  "$VLLM_IMAGE" \
  $VLLM_ARGS

# --------------------------------------------------
# 7. Wait for vLLM to become healthy
# --------------------------------------------------
echo "Waiting for vLLM to become healthy..."
MAX_WAIT=900
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $MAX_WAIT ]; do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "vLLM is healthy! (after ${ELAPSED}s)"
    echo "=== Startup completed at: $(date -u) ==="
    exit 0
  fi
  echo "  vLLM not ready yet (${ELAPSED}s elapsed). Checking container logs..."
  docker logs --tail 5 vllm-server 2>&1 || true
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "ERROR: vLLM did not become healthy within ${MAX_WAIT}s."
echo "Container logs:"
docker logs vllm-server 2>&1 || true
exit 1
