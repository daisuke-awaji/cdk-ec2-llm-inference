import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";
import { LlmInferenceConfig } from "../config";

export interface NetworkConstructProps {
  readonly config: LlmInferenceConfig;
}

export class NetworkConstruct extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly albSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkConstructProps) {
    super(scope, id);

    const { config } = props;

    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    this.albSecurityGroup = new ec2.SecurityGroup(this, "AlbSg", {
      vpc: this.vpc,
      description: "Security group for ALB (IP restricted)",
      allowAllOutbound: true,
    });

    for (const cidr of config.allowedCidrs) {
      this.albSecurityGroup.addIngressRule(
        ec2.Peer.ipv4(cidr),
        ec2.Port.tcp(80),
        `Allow HTTP from ${cidr}`
      );
    }

    this.alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
    });

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc: this.vpc,
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      healthCheck: {
        path: "/health",
        port: "8000",
        healthyHttpCodes: "200",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    this.listener = this.alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup],
    });
  }
}
