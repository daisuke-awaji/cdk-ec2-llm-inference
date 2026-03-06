# cdk-ec2-llm-inference

EC2 GPU インスタンス + vLLM で日本語 LLM の推論 API を構築する CDK スタック。

## Architecture

```
Client (IP restricted)
    │ HTTP :80
    ▼
ALB (Public, ap-northeast-1)
    │
    ▼
EC2 GPU Instance (Private Subnet)
├── Docker + vLLM DLC Container
│   └── OpenAI-compatible API (:8000)
│       ├── POST /v1/chat/completions
│       ├── POST /v1/completions
│       └── GET  /health
└── Model Weights (HuggingFace Hub → EBS cache)
```

## Default Model

**elyza/Llama-3-ELYZA-JP-8B-AWQ** (Llama 3 ベース日本語 LLM、AWQ 4bit 量子化)

- Instance: `g5.xlarge` (NVIDIA A10G × 1, 24GB VRAM)
- Cost: ~$1.0/h (On-Demand)

## Prerequisites

1. AWS CLI configured with appropriate credentials
2. Node.js 18+ and npm
3. CDK CLI (`npm install -g aws-cdk`)
4. HuggingFace token stored in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name hf-token \
  --secret-string "hf_xxxxxxxxxxxxxxxxxxxx" \
  --region ap-northeast-1
```

## Configuration

Edit `cdk.json` context to customize:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `modelId` | `elyza/Llama-3-ELYZA-JP-8B-AWQ` | HuggingFace model ID |
| `quantization` | `awq` | Quantization method (`none`, `awq`, `gptq`) |
| `maxModelLen` | `8192` | Max context length |
| `tensorParallelSize` | `1` | Number of GPUs for tensor parallelism |
| `gpuMemoryUtilization` | `0.9` | GPU memory utilization ratio |
| `instanceType` | `g5.xlarge` | EC2 instance type |
| `ebsVolumeSize` | `100` | EBS volume size (GB) |
| `allowedCidrs` | `["203.0.113.0/24"]` | Allowed CIDRs for ALB access |
| `vllmContainerImage` | `public.ecr.aws/.../vllm:0.15-gpu-py312-ec2` | vLLM DLC image |
| `huggingFaceTokenSecretName` | `hf-token` | Secrets Manager secret name |

### Model Switching Examples

**ELYZA 70B (full)**:
```jsonc
{
  "modelId": "elyza/Llama-3.1-ELYZA-JP-70B-Instruct",
  "quantization": "none",
  "instanceType": "p4d.24xlarge",
  "tensorParallelSize": 4
}
```

**Takane 32B**:
```jsonc
{
  "modelId": "fujitsu-llm/Takane-ba-32b-instruct",
  "quantization": "none",
  "instanceType": "g5.12xlarge",
  "tensorParallelSize": 2
}
```

## Deploy

```bash
# Install dependencies
npm install

# Deploy (update allowedCidrs first!)
npx cdk deploy

# Check outputs for ALB DNS name
```

## Usage

```bash
ALB_DNS="<AlbDnsName from stack output>"

curl http://$ALB_DNS/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "elyza/Llama-3-ELYZA-JP-8B-AWQ",
    "messages": [
      {"role": "system", "content": "あなたは誠実で優秀な日本人のアシスタントです。"},
      {"role": "user", "content": "日本の首都はどこですか？"}
    ],
    "max_tokens": 256,
    "temperature": 0.7
  }'
```

## Troubleshooting

Connect to the instance via SSM:

```bash
INSTANCE_ID="<InstanceId from stack output>"
aws ssm start-session --target $INSTANCE_ID --region ap-northeast-1
```

Check startup logs:

```bash
cat /var/log/llm-startup.log
docker logs vllm-server
```

## Cleanup

```bash
npx cdk destroy
```

