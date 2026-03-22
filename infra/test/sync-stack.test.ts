import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { PencilSyncStack } from '../lib/sync-stack';

function createTemplate(environmentName = 'dev'): Template {
    const app = new App();
    const stack = new PencilSyncStack(app, 'TestPencilSyncStack', {
        environmentName
    });

    return Template.fromStack(stack);
}

describe('PencilSyncStack', () => {
    const template = createTemplate();
    const prodTemplate = createTemplate('prod');

    test('creates the DynamoDB table with the required schema and recovery settings', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            TableName: 'pencil2-sync',
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: Match.arrayWith([
                Match.objectLike({
                    AttributeName: 'PK',
                    KeyType: 'HASH'
                }),
                Match.objectLike({
                    AttributeName: 'SK',
                    KeyType: 'RANGE'
                })
            ]),
            TimeToLiveSpecification: {
                AttributeName: 'expiresAt',
                Enabled: true
            },
            PointInTimeRecoverySpecification: {
                PointInTimeRecoveryEnabled: true
            }
        });
    });

    test('creates the SyncGSI with the required projection, key schema, and attribute definitions', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
            AttributeDefinitions: Match.arrayWith([
                Match.objectLike({ AttributeName: 'PK', AttributeType: 'S' }),
                Match.objectLike({ AttributeName: 'SK', AttributeType: 'S' }),
                Match.objectLike({ AttributeName: 'GSI1PK', AttributeType: 'S' }),
                Match.objectLike({ AttributeName: 'GSI1SK', AttributeType: 'S' })
            ]),
            GlobalSecondaryIndexes: Match.arrayWith([
                Match.objectLike({
                    IndexName: 'SyncGSI',
                    Projection: {
                        ProjectionType: 'ALL'
                    },
                    KeySchema: Match.arrayWith([
                        Match.objectLike({
                            AttributeName: 'GSI1PK',
                            KeyType: 'HASH'
                        }),
                        Match.objectLike({
                            AttributeName: 'GSI1SK',
                            KeyType: 'RANGE'
                        })
                    ])
                })
            ])
        });
    });

    test('creates the Cognito identity pool and authenticated role attachment', () => {
        template.hasResourceProperties('AWS::Cognito::IdentityPool', {
            AllowUnauthenticatedIdentities: false,
            DeveloperProviderName: 'login.pencil.school',
            IdentityPoolName: 'PencilSyncPool'
        });
        template.resourceCountIs('AWS::Cognito::IdentityPoolRoleAttachment', 1);
    });

    test('creates the auth lambda with the Node.js 18 runtime', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            FunctionName: 'pencil2-sync-auth',
            Handler: 'index.handler',
            Runtime: 'nodejs18.x'
        });
    });

    test('creates IAM policies with leading key isolation and a deny scan guardrail', () => {
        template.hasResourceProperties('AWS::IAM::Role', {
            RoleName: 'PencilSyncAuthRole',
            Policies: Match.arrayWith([
                Match.objectLike({
                    PolicyDocument: {
                        Statement: Match.arrayWith([
                            Match.objectLike({
                                Sid: 'AllowDynamoDBBaseTable',
                                Condition: {
                                    'ForAllValues:StringEquals': {
                                        'dynamodb:LeadingKeys': ['SCHOOL#${cognito-identity.amazonaws.com:sub}']
                                    }
                                }
                            }),
                            Match.objectLike({
                                Sid: 'DenyScan',
                                Effect: 'Deny',
                                Action: 'dynamodb:Scan'
                            })
                        ])
                    }
                })
            ])
        });
    });

    test('exposes the expected stack outputs and keeps DynamoDB in on-demand mode', () => {
        const templateJson = template.toJSON();
        const outputs = templateJson.Outputs ?? {};
        const tables = Object.values(template.findResources('AWS::DynamoDB::Table')) as Array<{
            Properties: {
                BillingMode?: string;
                ProvisionedThroughput?: unknown;
                GlobalSecondaryIndexes?: Array<{ ProvisionedThroughput?: unknown }>;
            };
        }>;

        expect(Object.keys(outputs)).toHaveLength(3);
        expect(outputs).toHaveProperty('AuthLambdaUrl');
        expect(outputs).toHaveProperty('IdentityPoolId');
        expect(outputs).toHaveProperty('SyncTableName');

        expect(tables).toHaveLength(1);
        expect(tables[0].Properties.BillingMode).toBe('PAY_PER_REQUEST');
        expect(tables[0].Properties.ProvisionedThroughput).toBeUndefined();
        expect(tables[0].Properties.GlobalSecondaryIndexes?.[0].ProvisionedThroughput).toBeUndefined();
    });

    test('keeps deletion behavior aligned with the synthesized environment and rejects deploy-time drift', () => {
        const devTemplateJson = template.toJSON();
        const prodTemplateJson = prodTemplate.toJSON();
        const devTable = Object.values(template.findResources('AWS::DynamoDB::Table'))[0] as {
            DeletionPolicy?: string;
            UpdateReplacePolicy?: string;
            Properties: { DeletionProtectionEnabled?: boolean };
        };
        const prodTable = Object.values(prodTemplate.findResources('AWS::DynamoDB::Table'))[0] as {
            DeletionPolicy?: string;
            UpdateReplacePolicy?: string;
            Properties: { DeletionProtectionEnabled?: boolean };
        };

        expect(devTable.DeletionPolicy).toBe('Delete');
        expect(devTable.UpdateReplacePolicy).toBe('Delete');
        expect(devTable.Properties.DeletionProtectionEnabled).not.toBe(true);

        expect(prodTable.DeletionPolicy).toBe('Retain');
        expect(prodTable.UpdateReplacePolicy).toBe('Retain');
        expect(prodTable.Properties.DeletionProtectionEnabled).toBe(true);

        expect(devTemplateJson.Rules).toHaveProperty('EnvironmentMatchesSynthContext');
        expect(prodTemplateJson.Rules).toHaveProperty('EnvironmentMatchesSynthContext');
    });
});
