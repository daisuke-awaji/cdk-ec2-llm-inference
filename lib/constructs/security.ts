import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface SecurityConstructProps {
  readonly vpc: ec2.Vpc;
  readonly albSecurityGroup: ec2.SecurityGroup;
  readonly huggingFaceTokenSecretName: string;
}

export class SecurityConstruct extends Construct {
  public readonly instanceRole: iam.Role;
  public readonly instanceSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    this.instanceSecurityGroup = new ec2.SecurityGroup(this, "InstanceSg", {
      vpc: props.vpc,
      description: "Security group for vLLM GPU instance",
      allowAllOutbound: true,
    });

    this.instanceSecurityGroup.addIngressRule(
      props.albSecurityGroup,
      ec2.Port.tcp(8000),
      "Allow vLLM traffic from ALB"
    );

    this.instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:aws:secretsmanager:*:*:secret:${props.huggingFaceTokenSecretName}*`,
        ],
      })
    );

    this.instanceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr-public:GetAuthorizationToken",
          "sts:GetServiceBearerToken",
          "ecr-public:BatchGetImage",
          "ecr-public:GetDownloadUrlForLayer",
        ],
        resources: ["*"],
      })
    );
  }
}
