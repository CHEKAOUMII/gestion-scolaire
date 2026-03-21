import * as cdk from 'aws-cdk-lib';
import {
    ArnFormat,
    CfnOutput,
    CfnParameter,
    Fn,
    RemovalPolicy,
    Stack,
    StackProps,
    Tags,
    aws_cognito as cognito,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_secretsmanager as secretsmanager
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

interface PencilSyncStackProps extends StackProps {
    environmentName?: string;
}

const RESOURCE_TAGS = {
    Project: 'pencil2',
    Feature: 'sync',
    Phase: '2-infrastructure',
    ManagedBy: 'cdk'
};

function applyResourceTags(resource: Construct, environmentValue: string): void {
    for (const [key, value] of Object.entries(RESOURCE_TAGS)) {
        Tags.of(resource).add(key, value);
    }

    Tags.of(resource).add('Environment', environmentValue);
}

export class PencilSyncStack extends Stack {
    constructor(scope: Construct, id: string, props?: PencilSyncStackProps) {
        super(scope, id, props);

        const environmentName = props?.environmentName ?? 'dev';
        const isDevEnvironment = environmentName === 'dev';
        const isProdEnvironment = environmentName === 'prod';
        const environmentParam = new CfnParameter(this, 'Environment', {
            type: 'String',
            allowedValues: ['dev', 'staging', 'prod'],
            default: environmentName
        });

        new cdk.CfnRule(this, 'EnvironmentMatchesSynthContext', {
            assertions: [
                {
                    assert: Fn.conditionEquals(environmentParam.valueAsString, environmentName),
                    assertDescription:
                        'Environment parameter must match the value used during synthesis. Re-run cdk synth with the desired Environment context before deploying.'
                }
            ]
        });

        const table = new dynamodb.Table(this, 'SyncTable', {
            tableName: 'pencil2-sync',
            partitionKey: {
                name: 'PK',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'SK',
                type: dynamodb.AttributeType.STRING
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'expiresAt',
            deletionProtection: isProdEnvironment,
            removalPolicy: isDevEnvironment ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN
        });

        table.addGlobalSecondaryIndex({
            indexName: 'SyncGSI',
            partitionKey: {
                name: 'GSI1PK',
                type: dynamodb.AttributeType.STRING
            },
            sortKey: {
                name: 'GSI1SK',
                type: dynamodb.AttributeType.STRING
            },
            projectionType: dynamodb.ProjectionType.ALL
        });

        const cfnTable = table.node.defaultChild as dynamodb.CfnTable;
        cfnTable.addPropertyOverride('PointInTimeRecoverySpecification', {
            PointInTimeRecoveryEnabled: true
        });

        applyResourceTags(table, environmentParam.valueAsString);

        const identityPool = new cognito.CfnIdentityPool(this, 'PencilSyncPool', {
            identityPoolName: 'PencilSyncPool',
            allowUnauthenticatedIdentities: false,
            developerProviderName: 'login.pencil.school'
        });

        applyResourceTags(identityPool, environmentParam.valueAsString);

        const leadingKeysCondition = {
            'ForAllValues:StringEquals': {
                'dynamodb:LeadingKeys': ['SCHOOL#${cognito-identity.amazonaws.com:sub}']
            }
        };

        const authenticatedRole = new iam.Role(this, 'PencilSyncAuthRole', {
            roleName: 'PencilSyncAuthRole',
            assumedBy: new iam.FederatedPrincipal(
                'cognito-identity.amazonaws.com',
                {
                    StringEquals: {
                        'cognito-identity.amazonaws.com:aud': identityPool.ref
                    },
                    'ForAnyValue:StringLike': {
                        'cognito-identity.amazonaws.com:amr': 'authenticated'
                    }
                },
                'sts:AssumeRoleWithWebIdentity'
            ),
            inlinePolicies: {
                DynamoDbScopedAccess: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            sid: 'AllowDynamoDBBaseTable',
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'dynamodb:GetItem',
                                'dynamodb:PutItem',
                                'dynamodb:UpdateItem',
                                'dynamodb:DeleteItem',
                                'dynamodb:Query',
                                'dynamodb:BatchGetItem',
                                'dynamodb:BatchWriteItem'
                            ],
                            resources: [table.tableArn],
                            conditions: leadingKeysCondition
                        }),
                        new iam.PolicyStatement({
                            sid: 'AllowDynamoDBGSIQuery',
                            effect: iam.Effect.ALLOW,
                            actions: ['dynamodb:Query'],
                            resources: [`${table.tableArn}/index/SyncGSI`],
                            conditions: leadingKeysCondition
                        }),
                        new iam.PolicyStatement({
                            sid: 'DenyScan',
                            effect: iam.Effect.DENY,
                            actions: ['dynamodb:Scan'],
                            resources: [`${table.tableArn}*`]
                        })
                    ]
                })
            }
        });

        applyResourceTags(authenticatedRole, environmentParam.valueAsString);

        new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authenticatedRole.roleArn
            }
        });

        const licenseSecret = secretsmanager.Secret.fromSecretNameV2(this, 'LicenseSecret', 'pencil2/license-secret');

        const authLambda = new lambda.Function(this, 'AuthLambda', {
            functionName: 'pencil2-sync-auth',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, 'auth-lambda')),
            timeout: cdk.Duration.seconds(10),
            memorySize: 256,
            environment: {
                COGNITO_IDENTITY_POOL_ID: identityPool.ref,
                DEVELOPER_PROVIDER_NAME: 'login.pencil.school',
                SECRET_ARN: licenseSecret.secretArn
            }
        });

        licenseSecret.grantRead(authLambda);

        const identityPoolArn = this.formatArn({
            service: 'cognito-identity',
            resource: 'identitypool',
            resourceName: identityPool.ref,
            arnFormat: ArnFormat.SLASH_RESOURCE_NAME
        });

        authLambda.addToRolePolicy(
            new iam.PolicyStatement({
                sid: 'CognitoDevAuth',
                effect: iam.Effect.ALLOW,
                actions: [
                    'cognito-identity:GetOpenIdTokenForDeveloperIdentity',
                    'cognito-identity:LookupDeveloperIdentity'
                ],
                resources: [identityPoolArn]
            })
        );

        applyResourceTags(authLambda, environmentParam.valueAsString);

        const authUrl = authLambda.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE
        });

        new CfnOutput(this, 'AuthLambdaUrl', {
            value: authUrl.url
        });

        new CfnOutput(this, 'IdentityPoolId', {
            value: identityPool.ref
        });

        new CfnOutput(this, 'SyncTableName', {
            value: table.tableName
        });
    }
}
