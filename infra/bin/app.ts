#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { PencilSyncStack } from '../lib/sync-stack';

const app = new App();
const environmentName = app.node.tryGetContext('Environment') ?? 'dev';

new PencilSyncStack(app, 'PencilSyncStack', {
    environmentName
});

app.synth();
