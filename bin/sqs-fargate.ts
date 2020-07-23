#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { SqsFargateStack } from '../lib/sqs-fargate-stack';

const app = new cdk.App();
new SqsFargateStack(app, 'SqsFargateStack');
