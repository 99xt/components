/**
 * Copyright (c) 2018, Cloudflare. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 *
 *  1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 *  2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 *  3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
 * OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

const fetch = require('node-fetch')
const fs = require('fs')

class CloudflareWorkers {
  constructor(credentials) {
    if (!credentials.authKey || !credentials.authEmail) {
      throw new Error(
        'Please make sure that you have "authKey" and "authEmail" set under "credentials" input property in your serverless.yml'
      )
    }

    this.credentials = credentials
  }

  async _cfApiCall({ url, method, contentType = null, body = null }) {
    const options = {
      headers: {
        'X-Auth-Email': this.credentials.authEmail,
        'X-Auth-Key': this.credentials.authKey
      },
      method: method
    }
    if (contentType) {
      options['headers']['Content-Type'] = contentType
    }
    if (body) {
      options['body'] = body
    }
    return fetch(url, options).then((responseBody) => responseBody.json())
  }

  // Cloudflare's script name for single script customers is their domain name
  async _getDefaultScriptName(zoneId) {
    const response = await this._cfApiCall({
      url: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
      method: `GET`,
      contentType: `application/json`
    })

    const { success, errors, result } = response
    if (success) {
      return result.name.replace('.', '-')
    }

    const errorMessage = errors.map((e) => e.message).join('\n')
    throw new Error(errorMessage)
  }

  async _getAccountId() {
    const response = await this._cfApiCall({
      url: `https://api.cloudflare.com/client/v4/accounts`,
      method: `GET`
    })
    const { success, result, errors } = response

    if (success) {
      return result[0]['id']
    }
    const errorMessage = errors.map((e) => e.message).join('\n')
    throw new Error(errorMessage)
  }

  async removeWorker({ accountId, scriptName }, context) {
    if (!context.state.routeId) {
      context.log('You must deploy a script to a route before you can remove it')
      return {}
    }
    const response = await this._cfApiCall({
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      method: `DELETE`,
      contentType: `application/javascript`
    })
    const { success, errors } = response
    if (success) {
      context.log(`✅  Script Removed Successfully: ${scriptName}`)
      return success
    }
    context.log(`❌  Script Removal Failed`)
    throw new Error(errors.map((e) => e.message).join('\n'))
  }

  async removeRoute({ route, zoneId }, context) {
    if (!context.state.routeId) {
      context.log('You must deploy a script to a route before you can remove it')
      return {}
    }

    const response = await this._cfApiCall({
      url: `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes/${
        context.state.routeId
      }`,
      method: `DELETE`
    })

    const { success, errors } = response
    if (success) {
      context.log(`✅  Route Disabled Successfully: ${route}`)
      return success
    }
    context.log(`❌  Route Removal Failed`)
    throw new Error(errors.map((e) => e.message).join('\n'))
  }

  async deployRoutes({ route, scriptName, zoneId }, context) {
    context.log('Assigning Script to Routes')
    const payload = { pattern: route, script: scriptName }
    const response = await this._cfApiCall({
      url: `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
      method: `POST`,
      contentType: `application/json`,
      body: JSON.stringify(payload)
    })

    const { success: routeSuccess, result: routeResult, errors: routeErrors } = response

    if (routeSuccess || !routeContainsFatalErrors(routeErrors)) {
      context.log(`✅  Routes Deployed ${route}`)
    } else {
      context.log(`❌  Fatal Error, Routes Not Deployed!`)
      routeErrors.forEach((err) => {
        const { code, message } = err
        context.log(`--> Error Code:${code}\n--> Error Message: "${message}"`)
      })
    }

    return { routeSuccess, routeResult, routeErrors }
  }

  async deployWorker({ accountId, scriptName, scriptPath }, context) {
    const workerScript = fs.readFileSync(scriptPath).toString()

    const response = await this._cfApiCall({
      url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`,
      contentType: `application/javascript`,
      body: workerScript,
      method: `PUT`
    })

    const { success: workerDeploySuccess, result: workerResult, errors: workerErrors } = response

    if (workerDeploySuccess) {
      context.log(`✅  Script Deployed ${scriptName}`)
    } else {
      context.log(`❌  Fatal Error, Script Not Deployed!`)
      workerErrors.forEach((err) => {
        const { code, message } = err
        context.log(`--> Error Code:${code}\n--> Error Message: "${message}"`)
      })
    }

    return { workerDeploySuccess, workerResult, workerErrors }
  }
}

const routeContainsFatalErrors = (errors) => {
  // suppress 10020 duplicate routes error
  // no need to show error when they are simply updating their script
  return errors.some((e) => e.code !== 10020)
}

const deploy = async (input, context) => {
  const cf = new CloudflareWorkers(input.credentials)
  if (!input.scriptName) {
    input.scriptName = await cf._getDefaultScriptName(input.zoneId)
  }
  if (!input.accountId) {
    input.accountId = await cf._getAccountId(input.credentials)
  }

  context.log(`Deploying Worker Script`)
  const workerScriptResponse = await cf.deployWorker(input, context)
  const routeResponse = await cf.deployRoutes(input, context)

  const outputs = { ...workerScriptResponse, ...routeResponse }

  const { routeResult, routeErrors, routeSuccess } = outputs

  const updatedState = {
    ...outputs,
    routeSuccess: routeSuccess || !routeContainsFatalErrors(routeErrors),
    routeId: routeResult ? routeResult.id : context.state.routeId
  }

  context.saveState(updatedState)
  return outputs
}

const remove = async (input, context) => {
  const cf = new CloudflareWorkers(input.credentials)
  context.log(`Removing script`)
  const { state } = context

  if (!context || !Object.keys(state).length) {
    throw new Error(`No state data found`)
  }
  if (state.workerDeploySuccess) {
    await cf.removeWorker(input, context)
  }

  if (state.routeSuccess) {
    await cf.removeRoute(input, context)
  }
  context.saveState()

  return {}
}

module.exports = {
  deploy,
  remove
}
