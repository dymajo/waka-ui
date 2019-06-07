/* eslint-disable promise/prefer-await-to-callbacks */
import AWSXRay from 'aws-xray-sdk'
const AWS = AWSXRay.captureAWS(require('aws-sdk'))
// import * as AWS from 'aws-sdk'
import logger from '../logger'
import { ECS } from 'aws-sdk'

class Fargate {
  cluster: string
  taskDefinition: string
  securityGroups: string[]
  subnets: string[]
  ecs: ECS
  constructor(config) {
    const { subnets, cluster, taskDefinition, securityGroups, region } = config
    if (!(subnets && cluster && taskDefinition && securityGroups)) {
      logger.warn('Cannot use Fargate Importer - Missing Config.')
      return
    }

    this.cluster = cluster
    this.taskDefinition = taskDefinition
    this.securityGroups = securityGroups
    this.subnets = subnets
    this.ecs = new AWS.ECS({ region })
  }

  async startTask(environment: ECS.KeyValuePair[]) {
    if (!this.ecs) {
      logger.warn('Cannot start task - missing config.')
      return
    }
    const { cluster, taskDefinition, securityGroups, subnets, ecs } = this
    const params: ECS.RunTaskRequest = {
      taskDefinition,
      cluster,
      count: 1,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups,
          assignPublicIp: 'ENABLED', // otherwise there is no route to the internet
        },
      },
      overrides: {
        containerOverrides: [{ name: 'waka-importer', environment }],
      },
    }
    logger.debug({ params }, 'Task Parameters')
    try {
      const data = await ecs.runTask(params).promise()
      logger.debug({ data })
      logger.info({ taskArn: data.tasks[0].taskArn }, 'Started Task')
    } catch (error) {
      logger.error({ error }, 'Could not start task.')
      return
    }
  }
}
export default Fargate
