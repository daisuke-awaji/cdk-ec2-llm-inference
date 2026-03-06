import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { loadConfig } from "./config";
import { NetworkConstruct } from "./constructs/network";
import { SecurityConstruct } from "./constructs/security";
import { ComputeConstruct } from "./constructs/compute";

export class LlmInferenceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = loadConfig(this);

    const network = new NetworkConstruct(this, "Network", { config });

    const security = new SecurityConstruct(this, "Security", {
      vpc: network.vpc,
      albSecurityGroup: network.albSecurityGroup,
      huggingFaceTokenSecretName: config.huggingFaceTokenSecretName,
    });

    const compute = new ComputeConstruct(this, "Compute", {
      config,
      vpc: network.vpc,
      instanceRole: security.instanceRole,
      instanceSecurityGroup: security.instanceSecurityGroup,
      targetGroup: network.targetGroup,
    });

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: network.alb.loadBalancerDnsName,
      description: "ALB DNS name for vLLM API",
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: `http://${network.alb.loadBalancerDnsName}/v1/chat/completions`,
      description: "OpenAI-compatible Chat Completions endpoint",
    });

    new cdk.CfnOutput(this, "ModelId", {
      value: config.modelId,
      description: "Deployed model ID",
    });
  }
}
