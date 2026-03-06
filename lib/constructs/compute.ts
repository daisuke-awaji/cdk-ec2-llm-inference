import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as elbv2_targets from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import * as path from "path";
import * as fs from "fs";
import { Construct } from "constructs";
import { LlmInferenceConfig } from "../config";

export interface ComputeConstructProps {
  readonly config: LlmInferenceConfig;
  readonly vpc: ec2.Vpc;
  readonly instanceRole: iam.Role;
  readonly instanceSecurityGroup: ec2.SecurityGroup;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
}

export class ComputeConstruct extends Construct {
  public readonly instance: ec2.Instance;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    const { config } = props;

    const ami = ec2.MachineImage.fromSsmParameter(config.amiSsmParameterPath);

    const userData = ec2.UserData.forLinux();
    const startupScript = fs.readFileSync(
      path.join(__dirname, "../../scripts/startup.sh"),
      "utf-8"
    );

    const renderedScript = startupScript
      .replace(/\{\{MODEL_ID\}\}/g, config.modelId)
      .replace(/\{\{QUANTIZATION\}\}/g, config.quantization)
      .replace(/\{\{MAX_MODEL_LEN\}\}/g, String(config.maxModelLen))
      .replace(
        /\{\{TENSOR_PARALLEL_SIZE\}\}/g,
        String(config.tensorParallelSize)
      )
      .replace(
        /\{\{GPU_MEMORY_UTILIZATION\}\}/g,
        String(config.gpuMemoryUtilization)
      )
      .replace(/\{\{VLLM_CONTAINER_IMAGE\}\}/g, config.vllmContainerImage)
      .replace(
        /\{\{HF_TOKEN_SECRET_NAME\}\}/g,
        config.huggingFaceTokenSecretName
      );

    userData.addCommands(renderedScript);

    this.instance = new ec2.Instance(this, "GpuInstance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: new ec2.InstanceType(config.instanceType),
      machineImage: ami,
      role: props.instanceRole,
      securityGroup: props.instanceSecurityGroup,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(config.ebsVolumeSize, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      requireImdsv2: true,
    });

    props.targetGroup.addTarget(
      new elbv2_targets.InstanceTarget(this.instance, 8000)
    );

    new cdk.CfnOutput(this, "InstanceId", {
      value: this.instance.instanceId,
      description: "EC2 Instance ID (use SSM to connect)",
    });
  }
}
