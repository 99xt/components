import { getProtocol } from './protocols'
import { setSubscriptionAttributes } from './protocols/lib'
import { concat, contains, equals, head, keys, map, reduce, slice, values } from '@serverless/utils'

const DEPLOY = 'deploy'
const REPLACE = 'replace'

const capitalize = (string) => `${head(string).toUpperCase()}${slice(1, Infinity, string)}`

const concatSubscriptionAttributes = (inputs, state = {}) =>
  concat(
    // inputs subscriptionAttributes as array
    map((key) => ({ [key]: inputs[key] }), keys(inputs)),
    // state subscriptionAttributes as array with removed items
    reduce(
      (attributes, key) => {
        if (!contains(key, keys(inputs))) {
          // return empty object to "unset" removed value
          return concat(attributes, [{ [key]: {} }])
        }
        return attributes
      },
      [],
      keys(state)
    )
  )

const setAllSubscriptionAttributes = async (subscriptionArn, inputs, context) => {
  const inputsAndState = concatSubscriptionAttributes(
    inputs.subscriptionAttributes,
    context.state.subscriptionAttributes
  )

  return Promise.all(
    map((item) => {
      const key = head(keys(item))
      const value = head(values(item))
      const params = {
        subscriptionArn: subscriptionArn,
        attributeName: capitalize(key),
        attributeValue: value
      }
      const stateAttribute = context.state.subscriptionAttributes
        ? context.state.subscriptionAttributes[key]
        : {}
      if (equals(value, stateAttribute)) {
        return Promise.resolve()
      }
      return setSubscriptionAttributes(params, context)
    }, inputsAndState)
  )
}

const AwsSnsSubscription = {
  shouldDeploy(prevInstance) {
    if (!prevInstance) {
      return DEPLOY
    }
    if (prevInstance.protocol !== this.protocol && prevInstance.topic !== this.topic) {
      return REPLACE
    }
  },

  async deploy(prevInstance, context) {
    const subscriptionArn = await getProtocol(this.protocol).deploy(this, context)
    return setAllSubscriptionAttributes(subscriptionArn, this, context)
  },

  async remove(prevInstance, context) {
    return getProtocol(this.protocol).remove(context)
  }
}

export default AwsSnsSubscription
