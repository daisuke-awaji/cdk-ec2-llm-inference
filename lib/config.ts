import { Construct } from "constructs";

export interface LlmInferenceConfig {
  readonly modelId: string;
  readonly quantization: "none" | "awq" | "gptq";
  readonly maxModelLen: number;
  readonly tensorParallelSize: number;
  readonly gpuMemoryUtilization: number;
  readonly instanceType: string;
  readonly ebsVolumeSize: number;
  readonly allowedCidrs: string[];
  readonly vllmContainerImage: string;
  readonly huggingFaceTokenSecretName: string;
  readonly amiSsmParameterPath: string;
}

export function loadConfig(scope: Construct): LlmInferenceConfig {
  return {
    modelId: scope.node.tryGetContext("modelId") ?? "elyza/Llama-3-ELYZA-JP-8B-AWQ",
    quantization: scope.node.tryGetContext("quantization") ?? "awq",
    maxModelLen: scope.node.tryGetContext("maxModelLen") ?? 8192,
    tensorParallelSize: scope.node.tryGetContext("tensorParallelSize") ?? 1,
    gpuMemoryUtilization: scope.node.tryGetContext("gpuMemoryUtilization") ?? 0.9,
    instanceType: scope.node.tryGetContext("instanceType") ?? "g5.xlarge",
    ebsVolumeSize: scope.node.tryGetContext("ebsVolumeSize") ?? 100,
    allowedCidrs: scope.node.tryGetContext("allowedCidrs") ?? ["203.0.113.0/24"],
    vllmContainerImage:
      scope.node.tryGetContext("vllmContainerImage") ??
      "public.ecr.aws/deep-learning-containers/vllm:0.15-gpu-py312-ec2",
    huggingFaceTokenSecretName:
      scope.node.tryGetContext("huggingFaceTokenSecretName") ?? "hf-token",
    amiSsmParameterPath:
      scope.node.tryGetContext("amiSsmParameterPath") ??
      "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp3/ami-id",
  };
}
