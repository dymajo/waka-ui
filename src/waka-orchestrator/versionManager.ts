import logger from './logger'
import KeyvalueLocal from './adaptors/keyvalueLocal'
import KeyvalueDynamo from './adaptors/keyvalueDynamo'
import EnvMapper from '../envMapper'
import GatewayLocal from './adaptors/gatewayLocal'
import GatewayEcs from './adaptors/gatewayEcs'
import { WakaConfig, VersionManagerProps, BaseKeyvalue } from '../typings'

class VersionManager {
  config: WakaConfig
  gateway: GatewayLocal | GatewayEcs
  envMapper: EnvMapper
  versions: BaseKeyvalue
  mappings: BaseKeyvalue
  constructor(props: VersionManagerProps) {
    const { gateway, config } = props
    this.config = config
    this.gateway = gateway
    this.envMapper = new EnvMapper()

    const kvPrefix = config.keyvaluePrefix
    const region = config.keyvalueRegion
    if (config.keyvalue === 'dynamo') {
      this.versions = new KeyvalueDynamo({
        name: `${kvPrefix}-versions`,
        region,
      })
      this.mappings = new KeyvalueDynamo({
        name: `${kvPrefix}-mappings`,
        region,
      })
    } else {
      this.versions = new KeyvalueLocal({ name: `${kvPrefix}-versions` })
      this.mappings = new KeyvalueLocal({ name: `${kvPrefix}-mappings` })
    }
  }

  async start() {
    logger.info('Starting Version Manager')

    // load active versions
    const mappingsTable = await this.mappings.scan()
    const mappings = Object.keys(mappingsTable)

    logger.info({ mappings }, `Found ${mappings.length} Mappings`)

    // load data for version
    mappings.forEach(prefix =>
      this.updateGateway(prefix, mappingsTable[prefix].value)
    )
  }

  async stop() {
    // This is never called, and it probably never should be.
    const mappingsTable = await this.mappings.scan()
    const mappings = Object.keys(mappingsTable)
    mappings.forEach(prefix => this.stopGateway(prefix))
  }

  async updateGateway(prefix, versionId) {
    const { gateway } = this

    const gatewayConfig = await this.getVersionConfig(versionId)
    logger.info({ prefix, version: gatewayConfig.version }, 'Updating Gateway')

    // We trust the gateways to handle the scheduling of new tasks / configs
    // We shouldn't have to stop the gateway or anything silly.
    gateway.start(prefix, gatewayConfig)
  }

  async recycleGateway(prefix) {
    const { gateway } = this
    logger.info({ prefix }, 'Recycling Gateway')
    const _mapping = (await this.mappings.get(prefix)) as unknown
    const mapping = _mapping as { id: string; value: string }
    const versionId = mapping.value
    const gatewayConfig = await this.getVersionConfig(versionId)
    gateway.recycle(prefix, gatewayConfig)
  }

  stopGateway(prefix) {
    const { gateway } = this
    logger.info({ prefix }, 'Stopping Gateway')
    gateway.stop(prefix)
  }

  async updateMapping(prefix, versionId) {
    await this.mappings.set(prefix, { value: versionId })
    await this.updateGateway(prefix, versionId)
  }

  async deleteMapping(prefix) {
    this.stopGateway(prefix)
    logger.info({ prefix }, 'Deleting Gateway')
    await this.mappings.delete(prefix)
  }

  async deleteWorker(id: string) {
    await this.versions.delete(id)
  }

  async checkVersionExists(prefix, version) {
    const { versions } = this
    const id = `${prefix.replace(/-/g, '_')}_${version
      .replace(/-/g, '_')
      .replace(/ /g, '_')}`
    const _data = (await versions.get(id)) as unknown
    const data = _data as {
      db: { database: string; password: string; server: string; user: string }
      id: string
      prefix: string
      shapesContainer: string
      shapesRegion: string
      status: string
      version: string
    }

    return {
      id,
      exists: Object.keys(data).length > 0,
    }
  }

  async addVersion(workerConfig: {
    prefix: string
    version: string
    shapesContainer: string
    shapesRegion: string
    dbconfig: string
  }) {
    const { config, versions } = this
    const {
      prefix,
      version,
      shapesContainer,
      shapesRegion,
      dbconfig,
    } = workerConfig

    // sanitizes the names
    const id = `${prefix.replace(/-/g, '_')}_${version
      .replace(/-/g, '_')
      .replace(/ /g, '_')}`
    const db = JSON.parse(JSON.stringify(config.db[dbconfig]))
    db.database = id

    const newConfig = {
      prefix,
      version,
      shapesContainer,
      shapesRegion,
      status: 'empty',
      db,
    }
    await versions.set(id, newConfig)
    return id
  }

  async getVersionConfig(versionId) {
    const { config, versions } = this

    // the gateway needs some settings from the orchestrator,
    // but also some settings from the worker config
    const _workerConfig = (await versions.get(versionId)) as unknown
    const workerConfig = _workerConfig as {
      db: { database: string; password: string; server: string; user: string }
      id: string
      prefix: string
      shapesContainer: string
      shapesRegion: string
      status: string
      version: string
    }
    const gatewayConfig = {
      prefix: workerConfig.prefix,
      version: workerConfig.version,
      storageService: config.storageService,
      shapesContainer: workerConfig.shapesContainer,
      shapesRegion: workerConfig.shapesRegion,
      status: workerConfig.status,
      api: config.api,
      db: {
        user: workerConfig.db.user,
        password: workerConfig.db.password,
        server: workerConfig.db.server,
        database: workerConfig.db.database,
        transactionLimit: config.transactionLimit,
        connectionTimeout: config.connectionTimeout,
        requestTimeout: config.requestTimeout,
      },
      // importer only, should be ignored
      keyvalue: config.keyvalue,
      keyvaluePrefix: config.keyvaluePrefix,
      keyvalueRegion: config.keyvalueRegion,
    }
    logger.debug({ config: gatewayConfig }, 'Gateway Config')
    return gatewayConfig
  }

  async updateVersionStatus(versionId: string, status) {
    // statuses:
    // empty -> pendingimport -> importing -> imported
    // empty -> pendingimport-willmap -> importing-willmap -> imported-willmap -> imported
    const { versions } = this
    const _version = (await versions.get(versionId)) as unknown
    const version = _version as {
      db: { database: string; password: string; server: string; user: string }
      id: string
      prefix: string
      shapesContainer: string
      shapesRegion: string
      status: string
      version: string
    }
    version.status = status
    await versions.set(versionId, version)
  }

  async allVersions() {
    // get all versions
    return this.versions.scan()
  }

  async allMappings() {
    // get all mappings
    return this.mappings.scan()
  }

  async getDockerCommand(versionId: string) {
    const config = await this.getVersionConfig(versionId)
    const env = this.envMapper.toEnvironmental(config, 'importer-local')
    const envArray = Object.keys(env).map(
      value => `${value}=${(env[value] || '').toString()}`
    )

    const command = `docker run -e "${envArray.join(
      '" -e "'
    )}" --network="container:waka-db" dymajo/waka-importer`
    return command
  }

  async getFargateVariables(versionId: string) {
    const config = await this.getVersionConfig(versionId)
    const env = this.envMapper.toEnvironmental(config, 'importer')
    const envArray = Object.keys(env).map(name => ({
      name,
      value: (env[name] || '').toString(),
    }))
    return envArray
  }
}

export default VersionManager
