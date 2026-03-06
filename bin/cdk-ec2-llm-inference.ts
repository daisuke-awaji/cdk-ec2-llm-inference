#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LlmInferenceStack } from "../lib/llm-inference-stack";

const app = new cdk.App();
new LlmInferenceStack(app, "LlmInferenceStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
});
