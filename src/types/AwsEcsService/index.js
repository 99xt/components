import { pick } from 'ramda'

const inputsProps = [
  'serviceName',
  'cluster',
  'launchType',
  'deploymentConfiguration',
  'desiredCount',
  'healthCheckGracePeriodSeconds',
  'networkConfiguration',
  'placementConstraints',
  'placementStrategy',
  'platformVersion',
  'role',
  'schedulingStrategy',
  'serviceRegistries',
  'taskDefinition',
  'loadBalancers'
]

export default {
  construct(inputs) {
    Object.assign(this, inputs)
  },

  async deploy(prevInstance, context) {
    const AWS = new this.provider.getSdk()
    const ecs = AWS.ECS()
    const state = context.getState(this)
    const inputs = pick(inputsProps, this)
    const serviceName = inputs.serviceName || `${context.instanceId}-service`

    if (state.serviceName && serviceName !== state.serviceName) {
      context.log('Change to ECS service name requires replacement. Making one now...')
      await this.remove(prevInstance, context)
    }

    const { services } = await ecs.describeServices({ services: [serviceName] }).promise()
    const existingService = Array.isArray(services) && services.shift()

    context.log(`Creating ECS service: "${serviceName}"`)
    const { taskDefinition: taskDefinitionOriginal, launchType, ...params } = inputs

    const taskDefinition =
      typeof taskDefinitionOriginal === 'string'
        ? taskDefinitionOriginal
        : `${taskDefinitionOriginal.family}:${taskDefinitionOriginal.revision}`

    const { service } = await (existingService && existingService.status === 'ACTIVE'
      ? ecs.updateService({ ...params, service: serviceName, taskDefinition }).promise()
      : ecs.createService({ ...inputs, taskDefinition, launchType }).promise())

    context.log(`ECS service "${serviceName}" created`)

    context.saveState(this, service || {})

    return Object.assign(this, service)
  },

  async remove(prevInstance, context) {
    const AWS = new this.provider.getSdk()
    const ecs = AWS.ECS()
    const state = context.getState(this)
    if (!state.hasOwnProperty('serviceName')) return {}

    const tasks = await ecs
      .listTasks({
        serviceName: state.serviceName
      })
      .promise()

    await ecs.updateService({ service: state.serviceName, desiredCount: 0 }).promise()
    await Promise.all(
      (tasks.taskArns || []).map((task) => {
        context.log(`Stopping task: "${task}"`)
        return ecs
          .stopTask({
            task,
            cluster: state.clusterArn,
            reason: 'Removing service'
          })
          .promise()
      })
    )

    await ecs.deleteService({ service: state.serviceName }).promise()
    context.log(`ECS service "${state.serviceName}" removed`)
    context.saveState(this, {})

    return Object.assign(this, {
      serviceArn: null,
      serviceName: null,
      events: null,
      clusterArn: null,
      loadBalancers: null,
      serviceRegistries: null,
      status: null,
      desiredCount: null,
      runningCount: null,
      pendingCount: null,
      launchType: null,
      platformVersion: null,
      taskDefinition: null,
      deploymentConfiguration: null,
      deployments: null,
      roleArn: null,
      createdAt: null,
      placementConstraints: null,
      placementStrategy: null,
      networkConfiguration: null,
      healthCheckGracePeriodSeconds: null,
      schedulingStrategy: null
    })
  },

  async get(prevInstance, context) {
    const AWS = new this.provider.getSdk()
    const ecs = AWS.ECS()
    const state = context.getState(this)
    if (!state.hasOwnProperty('serviceName')) return {}

    const { services } = await ecs.describeServices({ services: [state.serviceName] }).promise()

    const service = Array.isArray(services) ? services.shift() : {}

    context.saveState(this, service || {})

    return Object.assign(this, service)
  }
}
