// ============================================
// LAMBDA: COMPLIANCE TRAIN TRIGGER
// Creates a SageMaker training job using the
// HuggingFace DLC, monitors completion, and
// updates/creates the Serverless Inference endpoint.
//
// Triggered by: training-data-gen Lambda (async)
//               or manual invocation
// ============================================

import {
  SageMakerClient,
  CreateTrainingJobCommand,
  DescribeTrainingJobCommand,
  CreateModelCommand,
  DescribeModelCommand,
  CreateEndpointConfigCommand,
  CreateEndpointCommand,
  UpdateEndpointCommand,
  DescribeEndpointCommand,
  DeleteModelCommand,
  DeleteEndpointConfigCommand,
} from '@aws-sdk/client-sagemaker';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION || 'us-west-1';
const BUCKET = process.env.S3_BUCKET || 'retail-data-bcgr';
const SAGEMAKER_ROLE = process.env.SAGEMAKER_ROLE_ARN || '';
const ENDPOINT_NAME = 'chapters-compliance-classifier';
const MODEL_PREFIX = 'cannabis-compliance/training/models/';
const DATASETS_PREFIX = 'cannabis-compliance/training/datasets/compliance-classification/latest/';

// HuggingFace Deep Learning Container for PyTorch inference
// Region-specific URI pattern for us-west-1
const HF_TRAINING_IMAGE = `763104351884.dkr.ecr.${REGION}.amazonaws.com/huggingface-pytorch-training:2.1-transformers4.36-gpu-py310-cu121-ubuntu20.04`;
const HF_INFERENCE_IMAGE = `763104351884.dkr.ecr.${REGION}.amazonaws.com/huggingface-pytorch-inference:2.1-transformers4.36-cpu-py310-ubuntu22.04`;

const sagemaker = new SageMakerClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

// ─── Types ──────────────────────────────────────────────────────────────────

interface TrainTriggerEvent {
  source?: string;
  datasetPrefix?: string;
  latestPrefix?: string;
  stats?: Record<string, unknown>;
  modelVersion?: string;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export const handler = async (event: TrainTriggerEvent) => {
  console.log('[TrainTrigger] Starting training pipeline...', JSON.stringify(event));
  const startTime = Date.now();

  if (!SAGEMAKER_ROLE) {
    throw new Error('SAGEMAKER_ROLE_ARN environment variable is required');
  }

  // Step 1: Determine version
  const version = event.modelVersion || `v${Date.now()}`;
  const jobName = `compliance-classifier-${version}`.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 63);
  const modelOutputPath = `s3://${BUCKET}/${MODEL_PREFIX}`;

  console.log(`[TrainTrigger] Job name: ${jobName}, Version: ${version}`);

  // Step 2: Upload training code to S3
  // SageMaker needs the training script in S3 as a tar.gz
  // For simplicity, we reference the source_dir from S3
  const codeKey = `${MODEL_PREFIX}code/train.py`;
  const inferenceKey = `${MODEL_PREFIX}code/inference.py`;
  const requirementsKey = `${MODEL_PREFIX}code/requirements.txt`;

  // Note: The training script files should be uploaded to S3 as part of deployment
  // The build script handles this. Here we just reference them.

  // Step 3: Create SageMaker training job
  const trainingJobParams = {
    TrainingJobName: jobName,
    RoleArn: SAGEMAKER_ROLE,
    AlgorithmSpecification: {
      TrainingImage: HF_TRAINING_IMAGE,
      TrainingInputMode: 'File' as const,
    },
    HyperParameters: {
      model_name: 'distilbert-base-uncased',
      epochs: '5',
      train_batch_size: '32',
      eval_batch_size: '64',
      learning_rate: '2e-5',
      max_length: '256',
      sagemaker_program: 'train.py',
      sagemaker_submit_directory: `s3://${BUCKET}/${MODEL_PREFIX}code/sourcedir.tar.gz`,
    },
    InputDataConfig: [
      {
        ChannelName: 'train',
        DataSource: {
          S3DataSource: {
            S3DataType: 'S3Prefix' as const,
            S3Uri: `s3://${BUCKET}/${DATASETS_PREFIX}`,
            S3DataDistributionType: 'FullyReplicated' as const,
          },
        },
        ContentType: 'application/x-ndjson',
      },
      {
        ChannelName: 'validation',
        DataSource: {
          S3DataSource: {
            S3DataType: 'S3Prefix' as const,
            S3Uri: `s3://${BUCKET}/${DATASETS_PREFIX}`,
            S3DataDistributionType: 'FullyReplicated' as const,
          },
        },
        ContentType: 'application/x-ndjson',
      },
    ],
    OutputDataConfig: {
      S3OutputPath: modelOutputPath,
    },
    ResourceConfig: {
      InstanceCount: 1,
      InstanceType: 'ml.m5.xlarge',
      VolumeSizeInGB: 30,
    },
    StoppingCondition: {
      MaxRuntimeInSeconds: 3600, // 1 hour max
    },
    EnableManagedSpotTraining: true,
    // Spot training: save up to 70% cost
    StoppingCondition: {
      MaxRuntimeInSeconds: 3600,
      MaxWaitTimeInSeconds: 7200, // wait up to 2 hours for spot capacity
    },
    Tags: [
      { Key: 'Application', Value: 'chapters-data' },
      { Key: 'Purpose', Value: 'compliance-classifier' },
      { Key: 'Version', Value: version },
    ],
  };

  console.log('[TrainTrigger] Creating training job...');
  await sagemaker.send(new CreateTrainingJobCommand(trainingJobParams));

  // Step 4: Poll for training job completion
  // Lambda has 15min timeout; training typically takes 1-2 hours
  // For long training, we poll for a limited time then let the
  // monthly EventBridge schedule check on next invocation
  const maxPollTime = 13 * 60 * 1000; // 13 minutes (leave 2min buffer)
  const pollInterval = 30 * 1000; // 30 seconds
  let status = 'InProgress';
  let modelArtifacts: string | undefined;

  const pollStart = Date.now();
  while (Date.now() - pollStart < maxPollTime) {
    await sleep(pollInterval);

    const describe = await sagemaker.send(
      new DescribeTrainingJobCommand({ TrainingJobName: jobName })
    );
    status = describe.TrainingJobStatus || 'Unknown';
    console.log(`[TrainTrigger] Training status: ${status}`);

    if (status === 'Completed') {
      modelArtifacts = describe.ModelArtifacts?.S3ModelArtifacts;
      console.log(`[TrainTrigger] Training completed! Artifacts: ${modelArtifacts}`);
      break;
    } else if (status === 'Failed' || status === 'Stopped') {
      const reason = describe.FailureReason || 'Unknown';
      console.error(`[TrainTrigger] Training ${status}: ${reason}`);
      return { success: false, status, reason, jobName };
    }
  }

  // If still running, return status for monitoring
  if (status === 'InProgress') {
    console.log('[TrainTrigger] Training still in progress. Will deploy on next check.');
    return { success: true, status: 'training_in_progress', jobName, version };
  }

  // Step 5: Deploy model to Serverless Endpoint
  if (modelArtifacts) {
    await deployToEndpoint(jobName, version, modelArtifacts);
  }

  // Step 6: Save training metadata
  const metadata = {
    version,
    jobName,
    modelArtifacts,
    trainedAt: new Date().toISOString(),
    stats: event.stats,
    durationSeconds: (Date.now() - startTime) / 1000,
  };

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `${MODEL_PREFIX}${version}/metadata.json`,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: 'application/json',
  }));

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[TrainTrigger] Complete in ${duration}s.`);

  return { success: true, status: 'deployed', jobName, version, modelArtifacts };
};

// ─── Endpoint Deployment ────────────────────────────────────────────────────

async function deployToEndpoint(jobName: string, version: string, modelArtifacts: string): Promise<void> {
  const modelName = `compliance-classifier-${version}`.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 63);
  const configName = `${modelName}-config`;

  // Step 1: Create SageMaker Model
  console.log(`[TrainTrigger] Creating model: ${modelName}`);
  try {
    // Delete existing model with same name if it exists
    try {
      await sagemaker.send(new DescribeModelCommand({ ModelName: modelName }));
      await sagemaker.send(new DeleteModelCommand({ ModelName: modelName }));
    } catch {
      // Model doesn't exist, that's fine
    }

    await sagemaker.send(new CreateModelCommand({
      ModelName: modelName,
      ExecutionRoleArn: SAGEMAKER_ROLE,
      PrimaryContainer: {
        Image: HF_INFERENCE_IMAGE,
        ModelDataUrl: modelArtifacts,
        Environment: {
          SAGEMAKER_PROGRAM: 'inference.py',
          HF_TASK: 'text-classification',
        },
      },
      Tags: [
        { Key: 'Application', Value: 'chapters-data' },
        { Key: 'Version', Value: version },
      ],
    }));
  } catch (err) {
    console.error('[TrainTrigger] Failed to create model:', err);
    throw err;
  }

  // Step 2: Create Endpoint Config with Serverless settings
  console.log(`[TrainTrigger] Creating endpoint config: ${configName}`);
  try {
    try {
      await sagemaker.send(new DeleteEndpointConfigCommand({ EndpointConfigName: configName }));
    } catch {
      // Doesn't exist
    }

    await sagemaker.send(new CreateEndpointConfigCommand({
      EndpointConfigName: configName,
      ProductionVariants: [{
        VariantName: 'AllTraffic',
        ModelName: modelName,
        ServerlessConfig: {
          MemorySizeInMB: 2048,
          MaxConcurrency: 5,
        },
      }],
      Tags: [
        { Key: 'Application', Value: 'chapters-data' },
        { Key: 'Version', Value: version },
      ],
    }));
  } catch (err) {
    console.error('[TrainTrigger] Failed to create endpoint config:', err);
    throw err;
  }

  // Step 3: Create or Update Endpoint
  try {
    const existing = await sagemaker.send(
      new DescribeEndpointCommand({ EndpointName: ENDPOINT_NAME })
    );
    // Endpoint exists — update it
    console.log(`[TrainTrigger] Updating existing endpoint: ${ENDPOINT_NAME}`);
    await sagemaker.send(new UpdateEndpointCommand({
      EndpointName: ENDPOINT_NAME,
      EndpointConfigName: configName,
    }));
  } catch {
    // Endpoint doesn't exist — create it
    console.log(`[TrainTrigger] Creating new endpoint: ${ENDPOINT_NAME}`);
    await sagemaker.send(new CreateEndpointCommand({
      EndpointName: ENDPOINT_NAME,
      EndpointConfigName: configName,
      Tags: [
        { Key: 'Application', Value: 'chapters-data' },
        { Key: 'Purpose', Value: 'compliance-classifier' },
        { Key: 'Version', Value: version },
      ],
    }));
  }

  console.log(`[TrainTrigger] Endpoint ${ENDPOINT_NAME} deployment initiated.`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
