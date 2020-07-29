import * as sns from '@aws-cdk/aws-sns';
import * as subs from '@aws-cdk/aws-sns-subscriptions';
import * as sqs from '@aws-cdk/aws-sqs';
import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ecr from '@aws-cdk/aws-ecr';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as cw from '@aws-cdk/aws-cloudwatch';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';
import * as path from 'path';
import elbv2 = require('@aws-cdk/aws-elasticloadbalancingv2');

export class SqsFargateStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Build the VPC
    const vpc = new ec2.Vpc(this, "SqsFargateVPC", {
      maxAzs: 3, // Default is all AZs in region
    });

    // Build the ALB
    const lb = new elbv2.ApplicationLoadBalancer(this, 'application-loadbalancer', {
      vpc,
      internetFacing: true,
    });

    // Add an http listener
    const listener = lb.addListener('http-listener', {
      port: 80,
      open: true,
    });

    // SQS Queue
    const queue = new sqs.Queue(this, 'SqsFargateQueue', {
      visibilityTimeout: cdk.Duration.seconds(300)
    });

    // SNS Topic
    const topic = new sns.Topic(this, 'SqsFargateTopic');
    // Subscripbe SQS to SQS
    topic.addSubscription(new subs.SqsSubscription(queue));

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "SqsFargateCluster", {
      vpc: vpc,
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'FargateTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256
    });

    // Build and define the Container
    const container = taskDefinition.addContainer("simple-web-service", {
      //image: ecs.ContainerImage.fromEcrRepository(ecr.Repository.fromRepositoryArn(this, 'sleeper', 'arn:aws:ecr:eu-west-1:857610115750:repository/sleeper'), 'latest'),
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, "..", "simple-web-service")),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "SqsFargate" }),
      stopTimeout: cdk.Duration.seconds(120),
    });
    // Add port to container definition
    container.addPortMappings({
      containerPort: 80,
    });

    // Fargate Service
    const service = new ecs.FargateService(this, "service", {
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      cluster: cluster,
      taskDefinition: taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
    });

    // Add our ECS service as a target of the ALB
    const targetGroup = listener.addTargets('TargetGroup', {
      port: 80,
      targets: [service],
    });

    // Grant permissions to consume messages off queue
    queue.grantConsumeMessages(service.taskDefinition.taskRole)

    // Generating metric
    let scalingMetric = new cw.MathExpression({
      expression: "messagesVisible + messagesNotVisible",
      period: cdk.Duration.minutes(1),
      usingMetrics: {
        messagesVisible: queue.metricApproximateNumberOfMessagesVisible(),
        messagesNotVisible: queue.metricApproximateNumberOfMessagesNotVisible()
      }
    });

    // Scaling based on Queue Depth
    const scalingTarget = service.autoScaleTaskCount({ maxCapacity: 50, minCapacity: 0 });
    scalingTarget.scaleOnMetric('QueueMessagesScaling', {
      metric: scalingMetric,
      cooldown: cdk.Duration.minutes(1),
      scalingSteps: [
        { lower: 0, upper: 0, change: -10 },
        { lower: 1, upper: 10, change: +1 },
        { lower: 10, change: +5 },
        { lower: 30, change: +10 },
        { lower: 50, change: +50 }],
    });

    //// Scaling based on time - https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-applicationautoscaling.ScalableTarget.html
    // Scale-up at mightnight - time is in UTC
    scalingTarget.scaleOnSchedule('MidnightBatchProcessingUp', {
      schedule: {
        expressionString: 'cron(0 0 * * ? *)' // https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/ScheduledEvents.html#CronExpressions
      },
      minCapacity: 50,
      maxCapacity: 50,
    });
    // Scale-down at 2am
    scalingTarget.scaleOnSchedule('MidnightBatchProcessingDown', {
      schedule: {
        expressionString: 'cron(0 2 * * ? *)'
      },
      minCapacity: 0,
      maxCapacity: 2,
    });

  }
}
