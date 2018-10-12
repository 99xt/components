import { pick } from 'ramda'

const inputsProps = [
  'provider',
  'family',
  'cpu',
  'memory',
  'networkMode',
  'placementConstraints',
  'requiresCompatibilities',
  'executionRoleArn',
  'taskRoleArn',
  'containerDefinitions',
  'volumes'
]

export default {
  construct(inputs) {
    Object.assign(this, inputs)
  },

  async deploy(prevInstance, context) {
    const inputs = pick(inputsProps, this)
    const state = context.getState(this)
    const AWS = new this.provider.getSdk()
    const ecs = AWS.ECS()

    if (state.family && inputs.family !== state.family) {
      context.log('Change to ECS TaskDefinition "family" requires replacement. Making one now...')
      await this.remove({}, context)
    }

    const { taskDefinition } = await ecs.registerTaskDefinition(inputs).promise()
    context.log(`ECS TaskDefinition registered: "${inputs.family}"`)

    // Remove previous revision
    if (state.hasOwnProperty('family') && state.hasOwnProperty('revision')) {
      await this.remove({}, context)
    }

    context.saveState(this, taskDefinition || {})
    return Object.assign(this, taskDefinition)
  },

  async remove(prevInstance, context) {
    const AWS = new this.provider.getSdk()
    const ecs = AWS.ECS()
    const state = context.getState(this)
    if (!state.hasOwnProperty('family') || !state.hasOwnProperty('revision')) return {}

    await ecs
      .deregisterTaskDefinition({ taskDefinition: `${state.family}:${state.revision}` })
      .promise()
    context.log(`ECS TaskDefinition revision deregistered: "${state.family}:${state.revision}"`)

    context.saveState(this, {})
    return Object.assign(this, {
      taskDefinitionArn: null,
      containerDescriptions: null,
      family: null,
      taskRoleArn: null,
      executionRoleArn: null,
      networkMode: null,
      revisions: null,
      volumes: null,
      status: null,
      requiresAttributes: null,
      placementConstraints: null,
      compatibilities: null,
      requiresCompatibilities: null,
      cpu: null,
      memory: null
    })
  },

  async getTodo(prevInstance, context) {
    const AWS = new this.provider.getSdk()
    const ecs = AWS.ECS()
    const state = context.getState(this)
    if (!state.hasOwnProperty('family') || !state.hasOwnProperty('revision')) return {}

    const { taskDefinition } = await ecs
      .describeTaskDefinition({ taskDefinition: `${state.family}:${state.revision}` })
      .promise()

    context.saveState(this, taskDefinition || {})
    return Object.assign(this, taskDefinition)
  }
}
